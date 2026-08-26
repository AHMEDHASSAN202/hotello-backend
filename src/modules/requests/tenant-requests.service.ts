import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { WILDCARD } from '../roles/permissions.constants';
import { Room } from '../tenant-rooms/room.entity';
import { naiveUtc, startOfHotelDay } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { AssignRequestDto } from './dto/assign-request.dto';
import { CancelRequestDto } from './dto/cancel-request.dto';
import { ListTenantRequestsQueryDto } from './dto/list-tenant-requests-query.dto';
import { GuestRequest } from './request.entity';
import {
  FINAL_REQUEST_STATUSES,
  OPEN_REQUEST_STATUSES,
} from './requests.constants';

/** 15.4 AC1 — one board card. Staff read ar/en from the snapshot map. */
export interface TenantRequestView {
  id: string;
  itemNameEn: string;
  itemNameAr: string;
  icon: string;
  categoryId: string;
  roomNumber: string;
  floor: number | null;
  guestName: string;
  optionType: string | null;
  optionValue: string | null;
  note: string | null;
  noteLanguage: string | null;
  status: string;
  slaTargetMinutes: number;
  dueAt: Date;
  assignedTo: { id: string; name: string } | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  updatedAt: Date;
}

/** 15.5 AC3 — the drawer timeline adds actors, guest language, cancel note. */
export interface TenantRequestDetail extends TenantRequestView {
  guestLanguage: string;
  cancelNote: string | null;
  startedBy: { id: string; name: string } | null;
  completedBy: { id: string; name: string } | null;
  cancelledBy: { id: string; name: string } | null;
}

export interface BoardCounts {
  open: number;
  doneToday: number;
  overdueNow: number;
}

/**
 * Epic 15, Stories 15.4–15.6 — the tenant side of the requests loop.
 * Every query filters by the caller's hotelId; unknown/cross-tenant ids 404.
 * Transition matrix (15.5 AC1): new→in_progress|cancelled,
 * in_progress→done|cancelled; done/cancelled are final.
 */
@Injectable()
export class TenantRequestsService {
  constructor(
    @InjectRepository(GuestRequest)
    private readonly requestsRepo: Repository<GuestRequest>,
    @InjectRepository(Stay)
    private readonly staysRepo: Repository<Stay>,
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
    @InjectRepository(TenantUser)
    private readonly usersRepo: Repository<TenantUser>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Open board / delta feed — always ships counts + serverTime (note 4). */
  async listBoard(
    user: TenantUser,
    query: ListTenantRequestsQueryDto,
  ): Promise<{
    data: TenantRequestView[];
    counts: BoardCounts;
    serverTime: string;
  }> {
    const where = query.updatedSince
      ? {
          hotelId: user.hotelId,
          updatedAt: MoreThan(naiveUtc(query.updatedSince)),
        }
      : { hotelId: user.hotelId, status: In(OPEN_REQUEST_STATUSES) };
    const rows = await this.requestsRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return {
      data: await this.toViews(rows),
      counts: await this.counts(user.hotelId),
      serverTime: new Date().toISOString(),
    };
  }

  /** History tab — done/cancelled, filterable, paginated (15.4 AC1/AC2). */
  async listHistory(
    user: TenantUser,
    query: ListTenantRequestsQueryDto,
  ): Promise<{
    data: TenantRequestView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Record<string, unknown> = {
      hotelId: user.hotelId,
      status:
        query.status && FINAL_REQUEST_STATUSES.includes(query.status)
          ? query.status
          : In(FINAL_REQUEST_STATUSES),
    };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.assigneeId) where.assignedToId = query.assigneeId;
    if (query.floor !== undefined) {
      const rooms = await this.roomsRepo.find({
        where: { hotelId: user.hotelId, floor: query.floor },
        select: ['id'],
      });
      where.roomId = In(rooms.map((r) => r.id));
    }
    const [rows, total] = await this.requestsRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data: await this.toViews(rows), total, page, pageSize };
  }

  /** 15.6 AC3 — stats-lite: open / done today (hotel tz) / overdue now. */
  async counts(hotelId: string): Promise<BoardCounts> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    const dayStart = startOfHotelDay(
      hotel?.timezone ?? 'Africa/Cairo',
      new Date(),
    );
    const [open, doneToday, overdueNow] = await Promise.all([
      this.requestsRepo.count({
        where: { hotelId, status: In(OPEN_REQUEST_STATUSES) },
      }),
      this.requestsRepo.count({
        where: { hotelId, status: 'done', completedAt: MoreThan(dayStart) },
      }),
      this.requestsRepo.count({
        where: {
          hotelId,
          status: In(OPEN_REQUEST_STATUSES),
          dueAt: LessThan(new Date()),
        },
      }),
    ]);
    return { open, doneToday, overdueNow };
  }

  /**
   * 15.5 AC2 — assignee options: active staff whose role grants
   * requests.update (wildcard Owner included). Options-endpoint pattern
   * (roles/options): bare array, low permission gate.
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
        { perm: 'requests.update', wildcard: WILDCARD },
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

  /** 15.5 AC3 — drawer detail with full timeline + actors. */
  async getDetail(user: TenantUser, id: string): Promise<TenantRequestDetail> {
    const request = await this.requestsRepo.findOne({
      where: { id, hotelId: user.hotelId },
      relations: [
        'stay',
        'room',
        'assignedTo',
        'startedBy',
        'completedBy',
        'cancelledBy',
      ],
    });
    if (!request) throw this.notFound();
    const [view] = await this.toViews([request]);
    return {
      ...view,
      floor: request.room?.floor ?? null,
      guestName: request.stay?.guestName ?? '',
      guestLanguage: request.stay?.language ?? 'en',
      cancelNote: request.cancelNote,
      assignedTo: this.actor(request.assignedTo),
      startedBy: this.actor(request.startedBy),
      completedBy: this.actor(request.completedBy),
      cancelledBy: this.actor(request.cancelledBy),
    };
  }

  /** 15.5 AC1 — Start: new→in_progress, auto-assigns the actor if unowned. */
  async start(user: TenantUser, id: string): Promise<TenantRequestView> {
    const request = await this.findInHotel(user.hotelId, id);
    this.assertStatus(request, ['new']);
    request.status = 'in_progress';
    request.startedAt = new Date();
    request.startedById = user.id;
    if (!request.assignedToId) request.assignedToId = user.id;
    const saved = await this.requestsRepo.save(request);
    await this.audit('request.started', saved, user, {
      autoAssigned: saved.assignedToId === user.id,
    });
    return (await this.toViews([saved]))[0];
  }

  /** 15.5 AC1 — Complete: in_progress→done. SLA scope ends here (15.6 AC2). */
  async complete(user: TenantUser, id: string): Promise<TenantRequestView> {
    const request = await this.findInHotel(user.hotelId, id);
    this.assertStatus(request, ['in_progress']);
    request.status = 'done';
    request.completedAt = new Date();
    request.completedById = user.id;
    const saved = await this.requestsRepo.save(request);
    await this.audit('request.completed', saved, user, {});
    return (await this.toViews([saved]))[0];
  }

  /** 15.5 AC1 — staff cancel with reason; final states stay final. */
  async cancel(
    user: TenantUser,
    id: string,
    dto: CancelRequestDto,
  ): Promise<TenantRequestView> {
    const request = await this.findInHotel(user.hotelId, id);
    this.assertStatus(request, OPEN_REQUEST_STATUSES);
    request.status = 'cancelled';
    request.cancelledAt = new Date();
    request.cancelledById = user.id;
    request.cancelledReason = dto.reason;
    request.cancelNote = dto.note?.trim() || null;
    const saved = await this.requestsRepo.save(request);
    await this.audit('request.cancelled', saved, user, { reason: dto.reason });
    return (await this.toViews([saved]))[0];
  }

  /** 15.5 AC2 — assign/reassign to staff holding requests.update; null unassigns. */
  async assign(
    user: TenantUser,
    id: string,
    dto: AssignRequestDto,
  ): Promise<TenantRequestView> {
    const request = await this.findInHotel(user.hotelId, id);
    this.assertStatus(request, OPEN_REQUEST_STATUSES);
    let assignee: TenantUser | null = null;
    if (dto.assigneeId) {
      assignee = await this.usersRepo.findOne({
        where: { id: dto.assigneeId, hotelId: user.hotelId },
        relations: ['role'],
      });
      const grants =
        assignee &&
        assignee.status === 'active' &&
        (assignee.role.permissions.includes(WILDCARD) ||
          assignee.role.permissions.includes('requests.update'));
      if (!grants) {
        throw new UnprocessableEntityException({
          code: 'REQUEST_ASSIGNEE_INVALID',
          message: 'Assignee must be an active staff member who can work requests',
        });
      }
    }
    request.assignedToId = assignee?.id ?? null;
    const saved = await this.requestsRepo.save(request);
    await this.audit('request.assigned', saved, user, {
      assigneeId: assignee?.id ?? null,
    });
    return (await this.toViews([saved]))[0];
  }

  private async findInHotel(hotelId: string, id: string): Promise<GuestRequest> {
    const request = await this.requestsRepo.findOne({
      where: { id, hotelId },
    });
    if (!request) throw this.notFound();
    return request;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'REQUEST_NOT_FOUND',
      message: 'Request not found',
    });
  }

  /** Invalid transitions 409 with the current status (final states incl.). */
  private assertStatus(request: GuestRequest, allowed: string[]): void {
    if (!allowed.includes(request.status)) {
      throw new ConflictException({
        code: 'REQUEST_INVALID_STATUS',
        message: 'This action is not allowed in the request’s current status',
        status: request.status,
      });
    }
  }

  private actor(
    user: TenantUser | null | undefined,
  ): { id: string; name: string } | null {
    return user ? { id: user.id, name: user.name } : null;
  }

  private async audit(
    action: string,
    request: GuestRequest,
    actor: TenantUser,
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action,
      entityType: 'request',
      entityId: request.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: request.hotelId,
        status: request.status,
        ...extra,
      },
    });
  }

  /**
   * Batch-load stays (guest name), rooms (floor) and assignees per page —
   * never leftJoinAndSelect + skip/take + raw orderBy (repo law, the TypeORM
   * two-pass pagination gotcha).
   */
  private async toViews(rows: GuestRequest[]): Promise<TenantRequestView[]> {
    if (rows.length === 0) return [];
    const stayIds = [...new Set(rows.map((r) => r.stayId))];
    const roomIds = [...new Set(rows.map((r) => r.roomId))];
    const userIds = [
      ...new Set(rows.map((r) => r.assignedToId).filter(Boolean)),
    ] as string[];
    const [stays, rooms, users] = await Promise.all([
      this.staysRepo.find({ where: { id: In(stayIds) } }),
      this.roomsRepo.find({ where: { id: In(roomIds) } }),
      userIds.length
        ? this.usersRepo.find({ where: { id: In(userIds) } })
        : Promise.resolve([] as TenantUser[]),
    ]);
    const stayFor = new Map(stays.map((s) => [s.id, s]));
    const roomFor = new Map(rooms.map((r) => [r.id, r]));
    const userFor = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      itemNameEn: r.itemNames.en ?? '',
      itemNameAr: r.itemNames.ar ?? r.itemNames.en ?? '',
      icon: r.itemIcon,
      categoryId: r.categoryId,
      roomNumber: r.roomNumber,
      floor: roomFor.get(r.roomId)?.floor ?? null,
      guestName: stayFor.get(r.stayId)?.guestName ?? '',
      optionType: r.optionType,
      optionValue: r.optionValue,
      note: r.note,
      noteLanguage: r.noteLanguage,
      status: r.status,
      slaTargetMinutes: r.slaTargetMinutes,
      dueAt: r.dueAt,
      assignedTo: this.actor(userFor.get(r.assignedToId ?? '') ?? null),
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      cancelledAt: r.cancelledAt,
      cancelledReason: r.cancelledReason,
      updatedAt: r.updatedAt,
    }));
  }
}
