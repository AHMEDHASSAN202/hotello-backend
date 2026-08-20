import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsService } from '../hotels/tenant-urls.service';
import {
  NOTIFICATION_EVENTS,
  StayCodeIssuedEvent,
  safeEmit,
} from '../notifications/notification-events';
import { Room } from '../tenant-rooms/room.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ChangeRoomDto } from './dto/change-room.dto';
import { CreateStayDto } from './dto/create-stay.dto';
import { ListStaysQueryDto } from './dto/list-stays-query.dto';
import { UpdateStayDto } from './dto/update-stay.dto';
import { UpdateStaySettingsDto } from './dto/update-stay-settings.dto';
import { StayCodeService } from './stay-code.service';
import { Stay } from './stay.entity';
import { daysBetween, hotelLocalParts } from './stay-time';

/** What every stays screen renders — never includes the code hash. */
export interface StayView {
  id: string;
  roomId: string;
  roomNumber: string;
  floor: number | null;
  guestName: string;
  email: string | null;
  phone: string | null;
  language: string;
  guestsCount: number | null;
  note: string | null;
  checkInDate: string;
  checkOutDate: string;
  /** Active stays only (hotel-local, never negative); null once checked out. */
  nightsRemaining: number | null;
  status: string;
  checkoutType: string | null;
  checkedOutAt: Date | null;
  createdAt: Date;
}

export interface AvailableRoom {
  id: string;
  roomNumber: string;
  floor: number | null;
}

/**
 * Natural room ordering, app-side twin of NATURAL_ROOM_ORDER (floor, then
 * numeric prefix, then full number) — used where rooms are batch-loaded
 * instead of joined.
 */
export function naturalRoomCompare(
  a: { floor: number | null; roomNumber: string },
  b: { floor: number | null; roomNumber: string },
): number {
  const floorA = a.floor ?? Number.MAX_SAFE_INTEGER;
  const floorB = b.floor ?? Number.MAX_SAFE_INTEGER;
  if (floorA !== floorB) return floorA - floorB;
  const numA = parseInt(a.roomNumber, 10);
  const numB = parseInt(b.roomNumber, 10);
  const hasNumA = !Number.isNaN(numA);
  const hasNumB = !Number.isNaN(numB);
  if (hasNumA && hasNumB && numA !== numB) return numA - numB;
  if (hasNumA !== hasNumB) return hasNumA ? -1 : 1;
  return a.roomNumber.localeCompare(b.roomNumber);
}

/**
 * Stays (Epic 13). hotel_id always comes from the authenticated tenant user;
 * cross-tenant lookups 404 (never 403). Every mutation that touches room
 * availability runs lock-hotel-FIRST (the Epic 11 serialization point for
 * room-state races), then locks the room row; the partial unique index
 * UQ_stays_room_active backs the residual double check-in race at the DB.
 */
@Injectable()
export class TenantStaysService {
  private readonly logger = new Logger(TenantStaysService.name);

  constructor(
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    @InjectRepository(Room) private readonly roomsRepo: Repository<Room>,
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    private readonly dataSource: DataSource,
    private readonly auditLogs: AuditLogsService,
    private readonly stayCodes: StayCodeService,
    private readonly tenantUrls: TenantUrlsService,
    private readonly events: EventEmitter2,
  ) {}

  // ------------------------------------------------------------------
  // Check-in (13.1)
  // ------------------------------------------------------------------

  async checkIn(
    actor: TenantUser,
    dto: CreateStayDto,
  ): Promise<{ stay: StayView; code: string }> {
    this.assertDatesValid(dto.checkInDate, dto.checkOutDate);

    let hotel!: Hotel;
    let room!: Room;
    let code!: string;
    let stay: Stay;
    try {
      stay = await this.dataSource.transaction(async (manager) => {
        hotel = await this.lockHotel(manager, actor.hotelId);
        room = await this.lockAvailableRoom(manager, actor.hotelId, dto.roomId);

        const issued = await this.stayCodes.issueUniqueCode(
          manager,
          actor.hotelId,
        );
        code = issued.code;

        const repo = manager.getRepository(Stay);
        return repo.save(
          repo.create({
            hotelId: actor.hotelId,
            roomId: room.id,
            guestName: dto.guestName.trim(),
            email: dto.email?.trim() || null,
            phone: dto.phone?.trim() || null,
            language: dto.language,
            guestsCount: dto.guestsCount ?? null,
            note: dto.note?.trim() || null,
            codeHash: issued.codeHash,
            checkInDate: dto.checkInDate,
            checkOutDate: dto.checkOutDate,
            status: 'active',
          }),
        );
      });
    } catch (err) {
      throw this.mapRoomOccupiedRace(err);
    }

    // Audit after commit — guest name/room/dates, NEVER the code (13.1 AC5).
    await this.auditLogs.log({
      action: 'stay.checked_in',
      entityType: 'stay',
      entityId: stay.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        guestName: stay.guestName,
        roomNumber: room.roomNumber,
        checkInDate: stay.checkInDate,
        checkOutDate: stay.checkOutDate,
      },
    });

    if (stay.email) {
      await safeEmit(
        this.events,
        NOTIFICATION_EVENTS.STAY_CODE_ISSUED,
        {
          stayId: stay.id,
          hotelId: hotel.id,
          guestName: stay.guestName,
          guestEmail: stay.email,
          roomNumber: room.roomNumber,
          language: stay.language,
          hotelNameEn: hotel.nameEn,
          hotelNameAr: hotel.nameAr,
          slug: hotel.slug,
          guestAppUrl: this.tenantUrls.buildGuestUrl(hotel.slug),
          checkOutDate: stay.checkOutDate,
          rawCode: code,
        } satisfies StayCodeIssuedEvent,
        this.logger,
      );
    }

    return { stay: this.toView(stay, room, hotel), code };
  }

  // ------------------------------------------------------------------
  // Lists & detail (13.2)
  // ------------------------------------------------------------------

  async list(actor: TenantUser, query: ListStaysQueryDto) {
    if (query.view === 'history') return this.listHistory(actor, query);
    return this.listActive(actor, query);
  }

  /**
   * Active board: bounded by the hotel's room count, so it loads join-free in
   * one pass, batch-loads rooms, and filters/sorts app-side in room natural
   * order (13.2 AC1).
   */
  private async listActive(actor: TenantUser, query: ListStaysQueryDto) {
    const [stays, hotel] = await Promise.all([
      this.staysRepo.find({
        where: { hotelId: actor.hotelId, status: 'active' },
      }),
      this.loadHotel(actor.hotelId),
    ]);
    const rooms = await this.loadRoomsByIds(stays.map((s) => s.roomId));

    const term = query.search?.trim().toUpperCase();
    const filtered = stays.filter((stay) => {
      const room = rooms.get(stay.roomId);
      if (!room) return false;
      if (query.floor !== undefined && room.floor !== query.floor) return false;
      if (!term) return true;
      return (
        stay.guestName.toUpperCase().includes(term) ||
        room.roomNumber.toUpperCase().includes(term)
      );
    });

    filtered.sort((a, b) =>
      naturalRoomCompare(rooms.get(a.roomId)!, rooms.get(b.roomId)!),
    );

    return {
      data: filtered.map((stay) =>
        this.toView(stay, rooms.get(stay.roomId)!, hotel),
      ),
      total: filtered.length,
    };
  }

  /**
   * History: permanent records (no delete anywhere — 13.2 AC2), paginated,
   * newest checkout first. Join-free + batch-load (repo pagination law).
   * Room-number search goes through a subquery instead of a join.
   */
  private async listHistory(actor: TenantUser, query: ListStaysQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.staysRepo
      .createQueryBuilder('s')
      .where('s.hotelId = :hotelId', { hotelId: actor.hotelId })
      .andWhere(`s.status = 'checked_out'`);

    const term = query.search?.trim();
    if (term) {
      qb.andWhere(
        `(s.guestName ILIKE :q OR s.roomId IN (
           SELECT r."id" FROM "rooms" r
           WHERE r."hotelId" = :hotelId AND r."roomNumber" ILIKE :q
         ))`,
        { q: `%${term}%` },
      );
    }

    const [stays, total] = await qb
      .orderBy('s.checkedOutAt', 'DESC', 'NULLS LAST')
      .addOrderBy('s.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const rooms = await this.loadRoomsByIds(stays.map((s) => s.roomId));
    return {
      data: stays.map((stay) => this.toView(stay, rooms.get(stay.roomId)!)),
      total,
      page,
      pageSize,
    };
  }

  async detail(actor: TenantUser, id: string): Promise<StayView> {
    const stay = await this.findStayInHotel(actor.hotelId, id);
    const hotel =
      stay.status === 'active' ? await this.loadHotel(actor.hotelId) : null;
    return this.toView(stay, stay.room, hotel ?? undefined);
  }

  /**
   * Check-in / room-change picker (13.1 AC1): `active` rooms with no active
   * stay, in natural order. Grouping by floor happens client-side.
   */
  async availableRooms(actor: TenantUser): Promise<AvailableRoom[]> {
    const [rooms, activeStays] = await Promise.all([
      this.roomsRepo.find({
        where: { hotelId: actor.hotelId, status: 'active' },
      }),
      this.staysRepo.find({
        where: { hotelId: actor.hotelId, status: 'active' },
        select: ['roomId'],
      }),
    ]);
    const occupied = new Set(activeStays.map((s) => s.roomId));
    return rooms
      .filter((room) => !occupied.has(room.id))
      .sort(naturalRoomCompare)
      .map((room) => ({
        id: room.id,
        roomNumber: room.roomNumber,
        floor: room.floor,
      }));
  }

  /** Occupancy batch-load for the rooms list/detail (13.2 AC3 — no N+1). */
  async findActiveByRoomIds(roomIds: string[]): Promise<Map<string, Stay>> {
    if (roomIds.length === 0) return new Map();
    const stays = await this.staysRepo.find({
      where: { roomId: In([...new Set(roomIds)]), status: 'active' },
    });
    return new Map(stays.map((stay) => [stay.roomId, stay]));
  }

  // ------------------------------------------------------------------
  // Manage a stay (13.3) & checkout (13.4)
  // ------------------------------------------------------------------

  /**
   * 13.3 AC1 (extend/shorten) + AC5 (guest info). Date changes and info
   * changes audit separately (`stay.dates_changed` with old/new vs
   * `stay.updated` with a diff); sessions continue untouched either way.
   */
  async update(
    actor: TenantUser,
    id: string,
    dto: UpdateStayDto,
  ): Promise<StayView> {
    const stay = await this.findStayInHotel(actor.hotelId, id);
    this.assertActive(stay);
    const hotel = await this.loadHotel(actor.hotelId);

    let datesChange: { from: string; to: string } | null = null;
    if (dto.checkOutDate !== undefined && dto.checkOutDate !== stay.checkOutDate) {
      this.assertDatesValid(stay.checkInDate, dto.checkOutDate);
      const today = hotelLocalParts(hotel.timezone, new Date()).date;
      if (dto.checkOutDate < today) {
        throw new BadRequestException({
          code: 'INVALID_STAY_DATES',
          message: 'Check-out date cannot be in the past',
        });
      }
      datesChange = { from: stay.checkOutDate, to: dto.checkOutDate };
      stay.checkOutDate = dto.checkOutDate;
    }

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    const applyField = <K extends 'guestName' | 'email' | 'phone' | 'language' | 'guestsCount' | 'note'>(
      field: K,
      next: Stay[K] | undefined,
    ) => {
      if (next === undefined || next === stay[field]) return;
      diff[field] = { from: stay[field], to: next };
      stay[field] = next;
    };
    applyField('guestName', dto.guestName?.trim());
    applyField('language', dto.language);
    applyField('email', dto.email === undefined ? undefined : dto.email?.trim() || null);
    applyField('phone', dto.phone === undefined ? undefined : dto.phone?.trim() || null);
    applyField('guestsCount', dto.guestsCount === undefined ? undefined : dto.guestsCount);
    applyField('note', dto.note === undefined ? undefined : dto.note?.trim() || null);

    if (!datesChange && Object.keys(diff).length === 0) {
      return this.toView(stay, stay.room, hotel);
    }

    await this.staysRepo.save(stay);

    if (datesChange) {
      await this.auditLogs.log({
        action: 'stay.dates_changed',
        entityType: 'stay',
        entityId: stay.id,
        actorId: actor.id,
        metadata: {
          actorType: 'tenant_user',
          hotelId: actor.hotelId,
          checkOutDate: datesChange,
        },
      });
    }
    if (Object.keys(diff).length > 0) {
      await this.auditLogs.log({
        action: 'stay.updated',
        entityType: 'stay',
        entityId: stay.id,
        actorId: actor.id,
        metadata: { actorType: 'tenant_user', hotelId: actor.hotelId, diff },
      });
    }
    return this.toView(stay, stay.room, hotel);
  }

  /**
   * 13.3 AC2 — move the stay to another available room. Same lock discipline
   * and race mapping as check-in; the code and sessions ride the stay, so
   * the guest notices nothing.
   */
  async changeRoom(
    actor: TenantUser,
    id: string,
    dto: ChangeRoomDto,
  ): Promise<StayView> {
    let moved!: { stay: Stay; from: Room | null; to: Room };
    try {
      moved = await this.dataSource.transaction(async (manager) => {
        await this.lockHotel(manager, actor.hotelId);
        const stay = await manager.getRepository(Stay).findOne({
          where: { id, hotelId: actor.hotelId },
        });
        if (!stay) {
          throw new NotFoundException({
            code: 'STAY_NOT_FOUND',
            message: 'Stay not found',
          });
        }
        this.assertActive(stay);
        const from = await manager
          .getRepository(Room)
          .findOne({ where: { id: stay.roomId } });
        if (stay.roomId === dto.roomId) {
          return { stay, from, to: from! };
        }
        const to = await this.lockAvailableRoom(
          manager,
          actor.hotelId,
          dto.roomId,
        );
        stay.roomId = to.id;
        await manager.getRepository(Stay).save(stay);
        return { stay, from, to };
      });
    } catch (err) {
      throw this.mapRoomOccupiedRace(err);
    }

    if (moved.from?.id !== moved.to.id) {
      await this.auditLogs.log({
        action: 'stay.room_changed',
        entityType: 'stay',
        entityId: moved.stay.id,
        actorId: actor.id,
        metadata: {
          actorType: 'tenant_user',
          hotelId: actor.hotelId,
          from: moved.from?.roomNumber ?? null,
          to: moved.to.roomNumber,
        },
      });
    }
    const hotel = await this.loadHotel(actor.hotelId);
    return this.toView(moved.stay, moved.to, hotel);
  }

  /**
   * 13.3 AC4 — hash-only storage means "guest forgot the code" = regenerate:
   * a new unique code replaces the hash (old one dies instantly); existing
   * sessions survive because session validity rides on the stay, not the
   * code. Shown once, never audited.
   */
  async regenerateCode(
    actor: TenantUser,
    id: string,
  ): Promise<{ stay: StayView; code: string }> {
    let code!: string;
    const stay = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Stay);
      const row = await repo.findOne({
        where: { id, hotelId: actor.hotelId },
        relations: ['room'],
      });
      if (!row) {
        throw new NotFoundException({
          code: 'STAY_NOT_FOUND',
          message: 'Stay not found',
        });
      }
      this.assertActive(row);
      const issued = await this.stayCodes.issueUniqueCode(
        manager,
        actor.hotelId,
      );
      code = issued.code;
      row.codeHash = issued.codeHash;
      return repo.save(row);
    });

    await this.auditLogs.log({
      action: 'stay.code_regenerated',
      entityType: 'stay',
      entityId: stay.id,
      actorId: actor.id,
      metadata: { actorType: 'tenant_user', hotelId: actor.hotelId },
    });
    const hotel = await this.loadHotel(actor.hotelId);
    return { stay: this.toView(stay, stay.room, hotel), code };
  }

  /**
   * 13.4 AC1 — manual checkout. Final (AC4): every guest session dies on its
   * next request via the per-request stay check; the room frees instantly
   * (the partial unique index only covers `active` rows).
   */
  async checkout(actor: TenantUser, id: string): Promise<StayView> {
    const stay = await this.findStayInHotel(actor.hotelId, id);
    this.assertActive(stay);
    stay.status = 'checked_out';
    stay.checkoutType = 'manual';
    stay.checkedOutAt = new Date();
    stay.checkedOutById = actor.id;
    await this.staysRepo.save(stay);

    await this.auditLogs.log({
      action: 'stay.checked_out',
      entityType: 'stay',
      entityId: stay.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        checkoutType: 'manual',
        roomNumber: stay.room.roomNumber,
      },
    });
    return this.toView(stay, stay.room);
  }

  // ------------------------------------------------------------------
  // Stay settings (13.4 AC2)
  // ------------------------------------------------------------------

  async getSettings(hotelId: string): Promise<{ checkoutTime: string }> {
    const hotel = await this.loadHotel(hotelId);
    return { checkoutTime: hotel.checkoutTime };
  }

  async updateSettings(
    actor: TenantUser,
    dto: UpdateStaySettingsDto,
  ): Promise<{ checkoutTime: string }> {
    const hotel = await this.loadHotel(actor.hotelId);
    if (hotel.checkoutTime !== dto.checkoutTime) {
      const diff = {
        checkoutTime: { from: hotel.checkoutTime, to: dto.checkoutTime },
      };
      hotel.checkoutTime = dto.checkoutTime;
      await this.hotelsRepo.save(hotel);
      await this.auditLogs.log({
        action: 'hotel.updated',
        entityType: 'hotel',
        entityId: hotel.id,
        actorId: actor.id,
        metadata: { actorType: 'tenant_user', hotelId: hotel.id, diff },
      });
    }
    return { checkoutTime: hotel.checkoutTime };
  }

  // ------------------------------------------------------------------
  // Shared internals
  // ------------------------------------------------------------------

  /** 13.4 AC4 — `checked_out` is final; nothing on a dead stay mutates. */
  private assertActive(stay: Stay): void {
    if (stay.status !== 'active') {
      throw new ConflictException({
        code: 'STAY_NOT_ACTIVE',
        message: 'This stay has ended and can no longer be changed',
      });
    }
  }

  /** Cross-tenant chokepoint — 404, never 403 (repo law). */
  async findStayInHotel(hotelId: string, id: string): Promise<Stay> {
    const stay = await this.staysRepo.findOne({
      where: { id, hotelId },
      relations: ['room'],
    });
    if (!stay) {
      throw new NotFoundException({
        code: 'STAY_NOT_FOUND',
        message: 'Stay not found',
      });
    }
    return stay;
  }

  /**
   * The Epic 11 serialization point: everyone that mutates room state takes
   * the hotel row lock FIRST, so stays and rooms mutations can never
   * interleave their availability reads (recorded lock-ordering ruling).
   */
  private async lockHotel(
    manager: EntityManager,
    hotelId: string,
  ): Promise<Hotel> {
    const hotel = await manager.getRepository(Hotel).findOne({
      where: { id: hotelId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }
    return hotel;
  }

  private async loadHotel(hotelId: string): Promise<Hotel> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }
    return hotel;
  }

  private async loadRoomsByIds(ids: string[]): Promise<Map<string, Room>> {
    if (ids.length === 0) return new Map();
    const rooms = await this.roomsRepo.find({
      where: { id: In([...new Set(ids)]) },
    });
    return new Map(rooms.map((room) => [room.id, room]));
  }

  private assertDatesValid(checkInDate: string, checkOutDate: string): void {
    if (checkOutDate <= checkInDate) {
      throw new BadRequestException({
        code: 'INVALID_STAY_DATES',
        message: 'Check-out date must be after the check-in date',
      });
    }
  }

  /**
   * The single "is room X available for a stay?" answer (spec note 4) —
   * shared by check-in and room-change. Locks the room row (after the hotel
   * lock the caller already holds), 404s cross-tenant/unknown rooms, and
   * 409s non-active rooms and occupied rooms.
   */
  private async lockAvailableRoom(
    manager: EntityManager,
    hotelId: string,
    roomId: string,
  ): Promise<Room> {
    const room = await manager.getRepository(Room).findOne({
      where: { id: roomId, hotelId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!room) {
      throw new NotFoundException({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found',
      });
    }
    if (room.status !== 'active') {
      throw new ConflictException({
        code: 'ROOM_NOT_AVAILABLE',
        message: `Room ${room.roomNumber} is not available for stays`,
        roomNumber: room.roomNumber,
      });
    }
    const occupied = await manager.getRepository(Stay).findOne({
      where: { roomId: room.id, status: 'active' },
      select: ['id'],
    });
    if (occupied) {
      throw new ConflictException({
        code: 'ROOM_OCCUPIED',
        message: `Room ${room.roomNumber} already has an active stay`,
        roomNumber: room.roomNumber,
      });
    }
    return room;
  }

  /**
   * 13.1 AC2 — the loser of a same-millisecond double check-in hits the
   * partial unique index instead of the in-transaction check; map that
   * 23505 to the same 409 the check would have thrown.
   */
  private mapRoomOccupiedRace(err: unknown): unknown {
    if (
      err instanceof QueryFailedError &&
      (err.driverError as { code?: string; constraint?: string })?.code ===
        '23505' &&
      (err.driverError as { constraint?: string })?.constraint ===
        'UQ_stays_room_active'
    ) {
      return new ConflictException({
        code: 'ROOM_OCCUPIED',
        message: 'Room already has an active stay',
      });
    }
    return err;
  }

  toView(stay: Stay, room: Room, hotel?: Hotel): StayView {
    let nightsRemaining: number | null = null;
    if (stay.status === 'active' && hotel) {
      const today = hotelLocalParts(hotel.timezone, new Date()).date;
      nightsRemaining = Math.max(0, daysBetween(today, stay.checkOutDate));
    }
    return {
      id: stay.id,
      roomId: stay.roomId,
      roomNumber: room.roomNumber,
      floor: room.floor,
      guestName: stay.guestName,
      email: stay.email,
      phone: stay.phone,
      language: stay.language,
      guestsCount: stay.guestsCount,
      note: stay.note,
      checkInDate: stay.checkInDate,
      checkOutDate: stay.checkOutDate,
      nightsRemaining,
      status: stay.status,
      checkoutType: stay.checkoutType,
      checkedOutAt: stay.checkedOutAt,
      createdAt: stay.createdAt,
    };
  }
}
