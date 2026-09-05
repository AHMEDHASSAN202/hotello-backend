import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  applyLaneFilter,
  Lane,
  Laned,
  LaneTombstone,
  LaneTombstoneReason,
  requestedLanes,
} from '../../common/lanes';
import { Hotel } from '../hotels/hotel.entity';
import { PushService } from '../push/push.service';
import { WILDCARD } from '../roles/permissions.constants';
import { Room } from '../tenant-rooms/room.entity';
import { NATURAL_ROOM_ORDER } from '../tenant-rooms/tenant-rooms.service';
import {
  hotelLocalParts,
  naiveUtc,
  startOfHotelDay,
} from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { AssignRoomDto } from './dto/assign-room.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { ClearRoomDto } from './dto/clear-room.dto';
import { FlagRoomDto } from './dto/flag-room.dto';
import { InterruptRoomDto } from './dto/interrupt-room.dto';
import { ListBoardQueryDto } from './dto/list-board-query.dto';
import { UpdateHousekeepingSettingsDto } from './dto/update-housekeeping-settings.dto';
import { HousekeepingEventsService } from './housekeeping-events.service';
import {
  CleaningType,
  HousekeepingStatus,
} from './housekeeping.constants';
import { HkAction, transition } from './housekeeping-transitions';

/**
 * 20.2 AC1 — one board card. `roomStatus` is the operational axis (Epic 11);
 * `occupied` derives from the Epic 13 active-stay data.
 */
export interface HousekeepingRoomView {
  id: string;
  roomNumber: string;
  floor: number | null;
  roomStatus: string;
  housekeepingStatus: HousekeepingStatus;
  cleaningType: CleaningType | null;
  occupied: boolean;
  assignedTo: { id: string; name: string } | null;
  lastCleanedAt: Date | null;
  lastCleanedBy: { id: string; name: string } | null;
  updatedAt: Date;
}

/** Delta rows: a full view, or a tombstone the client must drop (Epic 19 pattern). */
export type HousekeepingRoomDelta =
  | HousekeepingRoomView
  | { id: string; active: false };

/** 20.2 AC2 — today at a glance; doneToday is the shift's progress bar. */
export interface HousekeepingBoardCounts {
  toCleanCheckout: number;
  toCleanDaily: number;
  inProgress: number;
  doneToday: number;
  dnd: number;
  /** 26.5 AC2 — only present when `assignee` was requested (Staff PWA). */
  myDoneToday?: number;
}

/** Room statuses that appear on the board (20.1 AC1 — inactive never shows). */
const BOARD_ROOM_STATUSES = ['active', 'out_of_service'];

/** 26.2 AC3 — the room lane rule: cleanable states only, no SLA/queue involved. */
const MY_ROOM_STATUSES: HousekeepingStatus[] = [
  'needs_cleaning',
  'in_progress',
  'dnd',
];

/** 26.2 AC3 — lane rule for rooms, relative to the caller. */
function laneOfRoom(view: HousekeepingRoomView, userId: string): Lane | null {
  if (view.assignedTo?.id === userId) {
    return MY_ROOM_STATUSES.includes(view.housekeepingStatus)
      ? 'mine'
      : null;
  }
  if (view.assignedTo === null && view.housekeepingStatus === 'needs_cleaning') {
    return 'available';
  }
  return null;
}
function reasonOfRoom(view: HousekeepingRoomView): LaneTombstoneReason {
  if (view.housekeepingStatus === 'clean') return 'closed';
  if (view.assignedTo !== null) return 'taken';
  return 'removed';
}

/**
 * Epic 20 — the housekeeping operations backbone. Every mutation funnels
 * through `housekeeping-transitions.ts`; every query filters by the caller's
 * hotelId (cross-tenant → 404). Endpoint-shaped on purpose: the Staff Task
 * PWA will consume these actions unchanged later.
 */
@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);

  constructor(
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
    @InjectRepository(Stay)
    private readonly staysRepo: Repository<Stay>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(TenantUser)
    private readonly usersRepo: Repository<TenantUser>,
    private readonly access: TenantAccessService,
    private readonly auditLogs: AuditLogsService,
    private readonly housekeepingEvents: HousekeepingEventsService,
    private readonly push: PushService,
  ) {}

  /** Board / delta feed — always ships counts + serverTime (note 5). */
  async listBoard(
    user: TenantUser,
    query: ListBoardQueryDto,
  ): Promise<{
    data: Array<HousekeepingRoomDelta | Laned<HousekeepingRoomView> | LaneTombstone>;
    counts: HousekeepingBoardCounts;
    serverTime: string;
  }> {
    let data: HousekeepingRoomDelta[];
    if (query.updatedSince) {
      // Changed rows regardless of status; rooms that turned inactive come
      // back as tombstones so the grid drops their card.
      const rows = await this.roomsRepo.find({
        where: {
          hotelId: user.hotelId,
          updatedAt: MoreThan(naiveUtc(query.updatedSince)),
        },
      });
      const views = await this.toViews(
        rows.filter((r) => BOARD_ROOM_STATUSES.includes(r.status)),
      );
      const viewFor = new Map(views.map((v) => [v.id, v]));
      data = rows.map(
        (r) => viewFor.get(r.id) ?? { id: r.id, active: false as const },
      );
    } else {
      const rows = await this.roomsRepo
        .createQueryBuilder('r')
        .where('r.hotelId = :hotelId', { hotelId: user.hotelId })
        .andWhere('r.status IN (:...statuses)', {
          statuses: BOARD_ROOM_STATUSES,
        })
        .orderBy('r.floor', 'ASC', 'NULLS LAST')
        .addOrderBy(NATURAL_ROOM_ORDER, 'ASC', 'NULLS LAST')
        .addOrderBy('r.roomNumber', 'ASC')
        .getMany();
      data = await this.toViews(rows);
    }
    let result: Array<
      HousekeepingRoomDelta | Laned<HousekeepingRoomView> | LaneTombstone
    > = data;
    if (query.assignee) {
      const lanes = requestedLanes(query.assignee);
      const mode = query.updatedSince ? 'delta' : 'full';
      result = data.flatMap((row) =>
        'active' in row
          ? [{ id: row.id, active: false as const, reason: 'removed' as const }]
          : applyLaneFilter(
              [row],
              lanes,
              (v) => laneOfRoom(v, user.id),
              reasonOfRoom,
              mode,
            ),
      );
    }
    const counts = await this.counts(user.hotelId);
    if (query.assignee) counts.myDoneToday = await this.myDoneToday(user);
    return {
      data: result,
      counts,
      serverTime: new Date().toISOString(),
    };
  }

  /** 20.2 AC2 — header stats (hotel-local "today"). */
  async counts(hotelId: string): Promise<HousekeepingBoardCounts> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    const dayStart = startOfHotelDay(
      hotel?.timezone ?? 'Africa/Cairo',
      new Date(),
    );
    const base = { hotelId, status: In(BOARD_ROOM_STATUSES) };
    const [toCleanCheckout, toCleanDaily, inProgress, doneToday, dnd] =
      await Promise.all([
        this.roomsRepo.count({
          where: {
            ...base,
            housekeepingStatus: 'needs_cleaning',
            cleaningType: 'checkout',
          },
        }),
        this.roomsRepo.count({
          where: {
            ...base,
            housekeepingStatus: 'needs_cleaning',
            cleaningType: 'daily',
          },
        }),
        this.roomsRepo.count({
          where: { ...base, housekeepingStatus: 'in_progress' },
        }),
        this.roomsRepo.count({
          where: { ...base, lastCleanedAt: MoreThan(dayStart) },
        }),
        this.roomsRepo.count({ where: { ...base, housekeepingStatus: 'dnd' } }),
      ]);
    return { toCleanCheckout, toCleanDaily, inProgress, doneToday, dnd };
  }

  /** 26.5 AC2 — my completions since the hotel-local day start (recorded decision 10). */
  private async myDoneToday(user: TenantUser): Promise<number> {
    const hotel = await this.hotelsRepo.findOne({
      where: { id: user.hotelId },
    });
    const dayStart = startOfHotelDay(
      hotel?.timezone ?? 'Africa/Cairo',
      new Date(),
    );
    return this.housekeepingEvents.countCompletedBy(
      user.hotelId,
      user.id,
      dayStart,
    );
  }

  /**
   * 20.3 AC1 — assignee options: active staff whose role grants
   * housekeeping.update (wildcard Owner included). Options-endpoint pattern.
   */
  async listAssignees(user: TenantUser): Promise<
    Array<{ id: string; name: string; roleNameEn: string; roleNameAr: string }>
  > {
    const users = await this.usersRepo
      .createQueryBuilder('u')
      .innerJoinAndSelect('u.role', 'r')
      .where('u.hotelId = :hotelId', { hotelId: user.hotelId })
      .andWhere(`u.status = 'active'`)
      .andWhere(
        `(r.permissions @> ARRAY[:perm]::text[] OR r.permissions @> ARRAY[:wildcard]::text[])`,
        { perm: 'housekeeping.update', wildcard: WILDCARD },
      )
      .orderBy('u.name', 'ASC')
      .getMany();
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      roleNameEn: u.role.nameEn,
      roleNameAr: u.role.nameAr,
    }));
  }

  /** 20.1 AC5 — manual flag with type; audit keeps the optional reason. */
  async flagRoom(
    user: TenantUser,
    id: string,
    dto: FlagRoomDto,
  ): Promise<HousekeepingRoomView> {
    const room = await this.findRoomInHotel(user.hotelId, id);
    this.apply(room, { type: 'flag', cleaningType: dto.cleaningType });
    const saved = await this.roomsRepo.save(room);
    await this.audit('housekeeping.flagged', saved, user.id, {
      actorType: 'tenant_user',
      cleaningType: dto.cleaningType,
      reason: dto.reason?.trim() || null,
    });
    await this.housekeepingEvents.record({
      hotelId: saved.hotelId,
      roomId: saved.id,
      eventType: 'flagged',
      cleaningType: dto.cleaningType,
      actorId: user.id,
      assignedToId: saved.housekeepingAssignedToId,
    });
    if (!saved.housekeepingAssignedToId && saved.housekeepingStatus === 'needs_cleaning') {
      await this.notifyStaffAvailableSafely(
        saved.hotelId,
        { excludeUserId: user.id },
        { feed: 'rooms', id: saved.id, roomNumber: saved.roomNumber, cleaningType: saved.cleaningType },
        saved.id,
      );
    }
    return (await this.toViews([saved]))[0];
  }

  /** 20.1 AC5 — manual unflag. */
  async clearRoom(
    user: TenantUser,
    id: string,
    dto: ClearRoomDto,
  ): Promise<HousekeepingRoomView> {
    const room = await this.findRoomInHotel(user.hotelId, id);
    this.apply(room, { type: 'clear' });
    const saved = await this.roomsRepo.save(room);
    await this.audit('housekeeping.cleared', saved, user.id, {
      actorType: 'tenant_user',
      reason: dto.reason?.trim() || null,
    });
    await this.housekeepingEvents.record({
      hotelId: saved.hotelId,
      roomId: saved.id,
      eventType: 'cleared',
      actorId: user.id,
      assignedToId: saved.housekeepingAssignedToId,
    });
    return (await this.toViews([saved]))[0];
  }

  /** 20.3 AC2 — Start: auto-assigns the actor if unowned (requests convention). */
  async start(user: TenantUser, id: string): Promise<HousekeepingRoomView> {
    const room = await this.findRoomInHotel(user.hotelId, id);
    this.apply(room, { type: 'start' });
    if (!room.housekeepingAssignedToId) {
      room.housekeepingAssignedToId = user.id;
    }
    const saved = await this.roomsRepo.save(room);
    await this.audit('housekeeping.started', saved, user.id, {
      actorType: 'tenant_user',
      autoAssigned: saved.housekeepingAssignedToId === user.id,
    });
    await this.housekeepingEvents.record({
      hotelId: saved.hotelId,
      roomId: saved.id,
      eventType: 'started',
      actorId: user.id,
      assignedToId: saved.housekeepingAssignedToId,
    });
    return (await this.toViews([saved]))[0];
  }

  /** 20.3 AC2/AC3 — Done: sets the room memory, releases the assignment. */
  async complete(user: TenantUser, id: string): Promise<HousekeepingRoomView> {
    const room = await this.findRoomInHotel(user.hotelId, id);
    const finishedType = room.cleaningType;
    const completedById = room.housekeepingAssignedToId;
    this.apply(room, { type: 'complete' });
    room.lastCleanedAt = new Date();
    room.lastCleanedById = user.id;
    room.housekeepingAssignedToId = null;
    const saved = await this.roomsRepo.save(room);
    await this.audit('housekeeping.completed', saved, user.id, {
      actorType: 'tenant_user',
      cleaningType: finishedType,
    });
    await this.housekeepingEvents.record({
      hotelId: saved.hotelId,
      roomId: saved.id,
      eventType: 'completed',
      cleaningType: finishedType,
      actorId: user.id,
      assignedToId: completedById,
    });
    return (await this.toViews([saved]))[0];
  }

  /** 20.3 AC2 — Stopped/interrupted, reason kept (in audit; state is current-only). */
  async interrupt(
    user: TenantUser,
    id: string,
    dto: InterruptRoomDto,
  ): Promise<HousekeepingRoomView> {
    const room = await this.findRoomInHotel(user.hotelId, id);
    this.apply(room, { type: 'interrupt' });
    const saved = await this.roomsRepo.save(room);
    await this.audit('housekeeping.interrupted', saved, user.id, {
      actorType: 'tenant_user',
      reason: dto.reason.trim(),
    });
    await this.housekeepingEvents.record({
      hotelId: saved.hotelId,
      roomId: saved.id,
      eventType: 'interrupted',
      actorId: user.id,
      assignedToId: saved.housekeepingAssignedToId,
    });
    return (await this.toViews([saved]))[0];
  }

  /** 20.3 AC1 — assign/reassign; null unassigns. Any cleanliness state is fine. */
  async assign(
    user: TenantUser,
    id: string,
    dto: AssignRoomDto,
  ): Promise<HousekeepingRoomView> {
    const room = await this.findRoomInHotel(user.hotelId, id);
    const assignee = await this.resolveAssignee(user.hotelId, dto.assigneeId);
    room.housekeepingAssignedToId = assignee?.id ?? null;
    const saved = await this.roomsRepo.save(room);
    await this.audit('housekeeping.assigned', saved, user.id, {
      actorType: 'tenant_user',
      assigneeId: assignee?.id ?? null,
    });
    if (assignee && assignee.id !== user.id) {
      await this.notifyStaffAssignedSafely(
        saved.hotelId,
        [assignee.id],
        { feed: 'rooms', id: saved.id, roomNumber: saved.roomNumber, cleaningType: saved.cleaningType },
        saved.id,
      );
    }
    return (await this.toViews([saved]))[0];
  }

  /**
   * 20.3 AC1 — bulk-assign a floor / selection. The FE resolves a floor to
   * room ids; ids outside the hotel are silently dropped (no cross-tenant
   * probing — the filter is the isolation boundary). One audit event.
   */
  async bulkAssign(
    user: TenantUser,
    dto: BulkAssignDto,
  ): Promise<HousekeepingRoomView[]> {
    const assignee = await this.resolveAssignee(user.hotelId, dto.assigneeId);
    const rooms = await this.roomsRepo.find({
      where: {
        id: In(dto.roomIds),
        hotelId: user.hotelId,
        status: In(BOARD_ROOM_STATUSES),
      },
    });
    for (const room of rooms) {
      room.housekeepingAssignedToId = assignee?.id ?? null;
    }
    const saved = await this.roomsRepo.save(rooms);
    await this.auditLogs.log({
      action: 'housekeeping.assigned',
      entityType: 'room',
      entityId: user.hotelId,
      actorId: user.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: user.hotelId,
        bulk: true,
        roomIds: saved.map((r) => r.id),
        count: saved.length,
        assigneeId: assignee?.id ?? null,
      },
    });
    if (assignee && assignee.id !== user.id && saved.length) {
      await this.notifyStaffAssignedSafely(
        user.hotelId,
        [assignee.id],
        { feed: 'rooms', count: saved.length, roomNumber: saved[0]?.roomNumber },
        null,
      );
    }
    return this.toViews(saved);
  }

  /** Housekeeping settings card (20.1 AC4). */
  async getSettings(hotelId: string): Promise<{ dailyServiceTime: string }> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) throw this.roomNotFound();
    return { dailyServiceTime: hotel.dailyServiceTime };
  }

  async updateSettings(
    user: TenantUser,
    dto: UpdateHousekeepingSettingsDto,
  ): Promise<{ dailyServiceTime: string }> {
    const hotel = await this.hotelsRepo.findOne({
      where: { id: user.hotelId },
    });
    if (!hotel) throw this.roomNotFound();
    const diff: Record<string, { from: string; to: string }> = {};
    if (dto.dailyServiceTime !== hotel.dailyServiceTime) {
      diff.dailyServiceTime = {
        from: hotel.dailyServiceTime,
        to: dto.dailyServiceTime,
      };
      hotel.dailyServiceTime = dto.dailyServiceTime;
      await this.hotelsRepo.save(hotel);
      await this.auditLogs.log({
        action: 'hotel.updated',
        entityType: 'hotel',
        entityId: hotel.id,
        actorId: user.id,
        metadata: { actorType: 'tenant_user', hotelId: hotel.id, diff },
      });
    }
    return { dailyServiceTime: hotel.dailyServiceTime };
  }

  /**
   * 20.1 AC3 — the one vacate emission point (note 3): manual checkout, auto
   * checkout and room-change all land here. Never throws — housekeeping
   * bookkeeping must not fail a checkout.
   */
  async onRoomVacated(
    roomId: string,
    hotelId: string,
    actorId: string | null,
  ): Promise<void> {
    try {
      const room = await this.roomsRepo.findOne({
        where: { id: roomId, hotelId },
      });
      if (!room) return;
      const result = transition(
        { status: room.housekeepingStatus, cleaningType: room.cleaningType },
        { type: 'vacate' },
      );
      if (!result.ok) return; // vacate never fails, but keep the compiler honest
      const from = room.housekeepingStatus;
      room.housekeepingStatus = result.state.status;
      room.cleaningType = result.state.cleaningType;
      room.dndSetByStayId = null; // DND dies with the stay (20.4 AC3)
      const saved = await this.roomsRepo.save(room);
      await this.audit('housekeeping.flagged', saved, actorId, {
        actorType: actorId ? 'tenant_user' : 'system',
        cleaningType: 'checkout',
        reason: 'room_vacated',
        from,
      });
      await this.housekeepingEvents.record({
        hotelId: saved.hotelId,
        roomId: saved.id,
        eventType: 'flagged',
        cleaningType: 'checkout',
        actorId,
        assignedToId: saved.housekeepingAssignedToId,
      });
      if (!saved.housekeepingAssignedToId && saved.housekeepingStatus === 'needs_cleaning') {
        await this.notifyStaffAvailableSafely(
          saved.hotelId,
          {},
          { feed: 'rooms', id: saved.id, roomNumber: saved.roomNumber, cleaningType: saved.cleaningType },
          saved.id,
        );
      }
    } catch (err) {
      this.logger.error(
        `housekeeping vacate hook failed for room ${roomId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /**
   * 20.4 — the guest DND toggle. Identity = session (the stay), module gated
   * here because TenantAccessGuard no-ops on @GuestScope routes. Idempotent
   * both ways (instant apply; double taps are not errors).
   */
  async setDnd(
    stay: Stay,
    active: boolean,
  ): Promise<{ dndActive: boolean }> {
    await this.assertHousekeepingAvailable(stay.hotelId);
    const room = await this.roomsRepo.findOne({
      where: { id: stay.roomId, hotelId: stay.hotelId },
    });
    if (!room) throw this.roomNotFound();
    const wasDnd = room.housekeepingStatus === 'dnd';
    const result = transition(
      { status: room.housekeepingStatus, cleaningType: room.cleaningType },
      { type: active ? 'dnd_on' : 'dnd_off' },
    );
    if (!result.ok) throw this.conflict(result.code, room.housekeepingStatus);
    room.housekeepingStatus = result.state.status;
    room.cleaningType = result.state.cleaningType;
    room.dndSetByStayId = active ? stay.id : null;
    if (active) {
      // "Keeps housekeeping away TODAY" (20.4): stamping the hotel-local date
      // marks today's service as handled, so the daily tick neither flags nor
      // releases this room before tomorrow's service hour (recorded decision).
      const hotel = await this.hotelsRepo.findOne({
        where: { id: stay.hotelId },
      });
      room.lastDailyFlaggedOn = hotelLocalParts(
        hotel?.timezone ?? 'Africa/Cairo',
        new Date(),
      ).date;
    }
    const saved = await this.roomsRepo.save(room);
    if (wasDnd !== active) {
      await this.audit(
        active ? 'housekeeping.dnd_set' : 'housekeeping.dnd_cleared',
        saved,
        null,
        { actorType: 'guest', stayId: stay.id },
      );
      await this.housekeepingEvents.record({
        hotelId: saved.hotelId,
        roomId: saved.id,
        eventType: active ? 'dnd_set' : 'dnd_cleared',
        actorId: null, // guest-initiated, no tenant user
      });
    }
    return { dndActive: saved.housekeepingStatus === 'dnd' };
  }

  /** Same posture as guest requests: suspended/read-only → unavailable. */
  private async assertHousekeepingAvailable(hotelId: string): Promise<void> {
    const state = await this.access.getAccessState(hotelId);
    if (state.hotelStatus === 'suspended' || state.readOnly) {
      throw new ForbiddenException({
        code: 'HOTEL_UNAVAILABLE',
        message: 'This hotel is currently unavailable',
      });
    }
    if (!state.enabledModules.includes('housekeeping')) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: 'This module is not included in your plan',
        module: 'housekeeping',
      });
    }
  }

  /** Runs the transition matrix and mutates the room, or 409s. */
  private apply(room: Room, action: HkAction): void {
    const result = transition(
      { status: room.housekeepingStatus, cleaningType: room.cleaningType },
      action,
    );
    if (!result.ok) throw this.conflict(result.code, room.housekeepingStatus);
    room.housekeepingStatus = result.state.status;
    room.cleaningType = result.state.cleaningType;
  }

  private conflict(code: string, status: HousekeepingStatus) {
    return new ConflictException({
      code,
      message:
        code === 'HOUSEKEEPING_ROOM_DND'
          ? 'The guest has switched on Do-Not-Disturb — cleaning starts after it lifts'
          : 'This action is not allowed in the room’s current cleaning state',
      status,
    });
  }

  /**
   * 26.4 AC2 ① — staff-assignment push (`assign`/`bulkAssign`).
   * `PushService.notify` never throws (Task 6's guarantee), but this
   * try/catch is defense in depth at the call site — a push failure must
   * never fail an already-committed transition.
   */
  private async notifyStaffAssignedSafely(
    hotelId: string,
    tenantUserIds: string[],
    vars: Record<string, unknown>,
    refId: string | null,
  ): Promise<void> {
    try {
      await this.push.notify(hotelId, { tenantUserIds }, 'staff_assigned', { refId, vars });
    } catch (err) {
      this.logger.error(
        `push notify(staff_assigned) failed for room ${refId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 26.4 AC2 ② — a fresh unassigned cleaning task (manual flag or vacate).
   * `excludeUserId` is only set for the manual-flag path (a human actor);
   * the vacate hook is system-triggered and excludes no one.
   */
  private async notifyStaffAvailableSafely(
    hotelId: string,
    extra: { excludeUserId?: string },
    vars: Record<string, unknown>,
    refId: string | null,
  ): Promise<void> {
    try {
      await this.push.notify(
        hotelId,
        { tenantPermission: 'housekeeping.update', mutedHintKey: 'staffPush.availableMuted', ...extra },
        'staff_available',
        { refId, vars },
      );
    } catch (err) {
      this.logger.error(
        `push notify(staff_available) failed for room ${refId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resolveAssignee(
    hotelId: string,
    assigneeId: string | null | undefined,
  ): Promise<TenantUser | null> {
    if (!assigneeId) return null;
    const assignee = await this.usersRepo.findOne({
      where: { id: assigneeId, hotelId },
      relations: ['role'],
    });
    const grants =
      assignee &&
      assignee.status === 'active' &&
      (assignee.role.permissions.includes(WILDCARD) ||
        assignee.role.permissions.includes('housekeeping.update'));
    if (!grants) {
      throw new UnprocessableEntityException({
        code: 'HOUSEKEEPING_ASSIGNEE_INVALID',
        message:
          'Assignee must be an active staff member who can work the cleaning queue',
      });
    }
    return assignee;
  }

  /** The cross-tenant chokepoint — unknown or foreign ids 404 identically. */
  private async findRoomInHotel(hotelId: string, id: string): Promise<Room> {
    const room = await this.roomsRepo.findOne({ where: { id, hotelId } });
    if (!room || room.status === 'inactive') throw this.roomNotFound();
    return room;
  }

  private roomNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'ROOM_NOT_FOUND',
      message: 'Room not found',
    });
  }

  private async audit(
    action: string,
    room: Room,
    actorId: string | null,
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action,
      entityType: 'room',
      entityId: room.id,
      actorId,
      metadata: {
        actorType: 'tenant_user',
        hotelId: room.hotelId,
        housekeepingStatus: room.housekeepingStatus,
        ...extra,
      },
    });
  }

  /**
   * Batch-load occupancy + names per page — never leftJoinAndSelect +
   * skip/take + raw orderBy (repo law).
   */
  private async toViews(rooms: Room[]): Promise<HousekeepingRoomView[]> {
    if (rooms.length === 0) return [];
    const roomIds = rooms.map((r) => r.id);
    const userIds = [
      ...new Set(
        rooms
          .flatMap((r) => [r.housekeepingAssignedToId, r.lastCleanedById])
          .filter(Boolean),
      ),
    ] as string[];
    const [activeStays, users] = await Promise.all([
      this.staysRepo.find({
        where: { roomId: In(roomIds), status: 'active' },
        select: ['id', 'roomId'],
      }),
      userIds.length
        ? this.usersRepo.find({ where: { id: In(userIds) } })
        : Promise.resolve([] as TenantUser[]),
    ]);
    const occupiedRooms = new Set(activeStays.map((s) => s.roomId));
    const userFor = new Map(users.map((u) => [u.id, u]));
    const actor = (id: string | null) => {
      const u = id ? userFor.get(id) : undefined;
      return u ? { id: u.id, name: u.name } : null;
    };
    return rooms.map((r) => ({
      id: r.id,
      roomNumber: r.roomNumber,
      floor: r.floor,
      roomStatus: r.status,
      housekeepingStatus: r.housekeepingStatus,
      cleaningType: r.cleaningType,
      occupied: occupiedRooms.has(r.id),
      assignedTo: actor(r.housekeepingAssignedToId),
      lastCleanedAt: r.lastCleanedAt,
      lastCleanedBy: actor(r.lastCleanedById),
      updatedAt: r.updatedAt,
    }));
  }
}
