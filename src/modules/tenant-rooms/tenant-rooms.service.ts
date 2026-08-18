import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { COUNTABLE_ROOM_STATUSES, Room } from './room.entity';
import { RoomType } from './room-type.entity';

/**
 * Story 11.2 — the natural-sort expression for room numbers: numeric prefix
 * cast to bigint (so "2" sorts before "10"), `NULLIF` turns a non-numeric
 * prefix (or none at all) into SQL NULL so those rows fall through to the
 * `NULLS LAST` tiebreak on the plain `roomNumber` string. Exported so tests
 * can assert the exact expression reaches the query builder.
 */
export const NATURAL_ROOM_ORDER = `NULLIF(regexp_replace(r."roomNumber", '\\D.*$', ''), '')::bigint`;

/** `RoomView` shape returned by list + detail (Story 11.2). */
export interface RoomView {
  id: string;
  roomNumber: string;
  floor: number | null;
  status: Room['status'];
  roomType: { id: string; nameEn: string; nameAr: string };
}

@Injectable()
export class TenantRoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly subscriptions: SubscriptionsService,
    private readonly dataSource: DataSource,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Story 11.2 AC2/AC3 — hotel-scoped, filterable, naturally-sorted room
   * list plus the plan usage counter. `usage.used` reads the hotel's
   * derived `roomsCount` (kept live by every mutation in this epic) rather
   * than a live COUNT, so the list path stays cheap.
   */
  async list(hotelId: string, query: ListRoomsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const qb = this.roomsRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.roomType', 'type')
      .where('r.hotelId = :hotelId', { hotelId });

    if (query.floor !== undefined) {
      qb.andWhere('r.floor = :floor', { floor: query.floor });
    }
    if (query.typeId) {
      qb.andWhere('r.roomTypeId = :typeId', { typeId: query.typeId });
    }
    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }
    if (query.search) {
      qb.andWhere('r."roomNumber" ILIKE :q', {
        q: `%${query.search.trim().toUpperCase()}%`,
      });
    }

    // Story 11.2 AC2 — floor groups first (unset floors last), then the
    // "101, 102, …, 110" natural order within a floor.
    qb.orderBy('r.floor', 'ASC', 'NULLS LAST')
      .addOrderBy(NATURAL_ROOM_ORDER, 'ASC', 'NULLS LAST')
      .addOrderBy('r.roomNumber', 'ASC');

    // Rooms page, hotel (for the derived counter) and the plan limit are
    // independent lookups — fetch them concurrently.
    const [[rows, total], hotel, max] = await Promise.all([
      qb
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getManyAndCount(),
      this.hotelsRepo.findOne({ where: { id: hotelId } }),
      this.roomsLimit(hotelId),
    ]);
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }

    return {
      data: rows.map((room) => this.toRoomView(room)),
      total,
      page,
      pageSize,
      usage: {
        used: hotel.roomsCount,
        max,
      },
    };
  }

  /**
   * Story 11.2 AC1/isolation — the cross-tenant chokepoint every later
   * rooms task reuses. Cross-tenant or unknown ids 404, never confirm
   * another hotel's room exists.
   */
  async findRoomInHotel(hotelId: string, id: string): Promise<Room> {
    const room = await this.roomsRepo.findOne({
      where: { id, hotelId },
      relations: ['roomType'],
    });
    if (!room) {
      throw new NotFoundException({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found',
      });
    }
    return room;
  }

  /** Story 11.2 — the room detail view (roomType relation; guestUrl lands in Task 8). */
  async detail(hotelId: string, id: string): Promise<RoomView> {
    const room = await this.findRoomInHotel(hotelId, id);
    return this.toRoomView(room);
  }

  /** Story 11.2 AC3 — the current plan's `maxRooms` (`null` = unlimited). */
  async roomsLimit(hotelId: string): Promise<number | null> {
    const { current } = await this.subscriptions.getForHotel(hotelId);
    return current?.plan?.maxRooms ?? null;
  }

  /**
   * Countable rooms = `active` + `out_of_service` (global constraint).
   * A live COUNT within a caller's transaction — used by later tasks
   * (bulk create/import) that must check the plan limit against rooms not
   * yet reflected in `hotel.roomsCount`.
   */
  async countCountable(manager: EntityManager, hotelId: string): Promise<number> {
    return manager
      .getRepository(Room)
      .createQueryBuilder('r')
      .where('r.hotelId = :hotelId', { hotelId })
      .andWhere('r.status IN (:...statuses)', {
        statuses: COUNTABLE_ROOM_STATUSES,
      })
      .getCount();
  }

  /**
   * Story 11.3 AC1/AC3/AC5 — create a single room. Runs the seat-limit check,
   * room-type validation and dupe check inside one transaction (pessimistic
   * hotel lock, so two concurrent creates for the last seat can't both pass),
   * then audits after commit.
   */
  async createRoom(actor: TenantUser, dto: CreateRoomDto): Promise<Room> {
    const room = await this.dataSource.transaction(async (manager) => {
      const { hotel, used } = await this.assertRoomSeatAvailable(
        manager,
        actor.hotelId,
        1,
      );
      const roomType = await this.assertTypeInHotel(
        manager,
        actor.hotelId,
        dto.roomTypeId,
      );

      const roomNumber = dto.roomNumber.trim().toUpperCase();
      const dupe = await manager
        .getRepository(Room)
        .findOne({ where: { hotelId: actor.hotelId, roomNumber } });
      if (dupe) {
        throw new ConflictException({
          code: 'ROOM_NUMBER_TAKEN',
          message: `Room ${roomNumber} already exists`,
          roomNumber,
        });
      }

      const roomsRepo = manager.getRepository(Room);
      const saved = await roomsRepo.save(
        roomsRepo.create({
          hotelId: actor.hotelId,
          roomNumber,
          floor: dto.floor ?? null,
          roomTypeId: dto.roomTypeId,
          status: dto.status ?? 'active',
        }),
      );

      hotel.roomsCount = used + 1;
      await manager.getRepository(Hotel).save(hotel);

      saved.roomType = roomType;
      return saved;
    });

    await this.auditLogs.log({
      action: 'room.created',
      entityType: 'room',
      entityId: room.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        roomNumber: room.roomNumber,
      },
    });

    return room;
  }

  /**
   * Story 11.3 AC3 — THE chokepoint for the plan room-limit guard, reused by
   * bulk create and status-change tasks. Locks the hotel row
   * (`pessimistic_write`) so the count and the limit check happen atomically
   * within the caller's transaction, then hands back `{ hotel, used }` so the
   * caller updates `hotel.roomsCount` itself (the exact seats it is adding
   * may differ per caller).
   */
  private async assertRoomSeatAvailable(
    manager: EntityManager,
    hotelId: string,
    adding: number,
  ): Promise<{ hotel: Hotel; used: number }> {
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

    const used = await this.countCountable(manager, hotelId);
    const limit = await this.roomsLimit(hotelId);
    if (limit !== null && used + adding > limit) {
      throw new ConflictException({
        code: 'ROOM_LIMIT_REACHED',
        message: `Your plan allows up to ${limit} room(s)`,
        limit,
        used,
        remaining: Math.max(0, limit - used),
      });
    }

    return { hotel, used };
  }

  /** Story 11.3 — resolve a room type within the hotel inside a transaction. */
  private async assertTypeInHotel(
    manager: EntityManager,
    hotelId: string,
    roomTypeId: string,
  ): Promise<RoomType> {
    const type = await manager
      .getRepository(RoomType)
      .findOne({ where: { id: roomTypeId, hotelId } });
    if (!type) {
      throw new NotFoundException({
        code: 'ROOM_TYPE_NOT_FOUND',
        message: 'Room type not found',
      });
    }
    return type;
  }

  /** Public: the controller maps `createRoom`'s `Room` result through this. */
  toRoomView(room: Room): RoomView {
    return {
      id: room.id,
      roomNumber: room.roomNumber,
      floor: room.floor,
      status: room.status,
      roomType: {
        id: room.roomType.id,
        nameEn: room.roomType.nameEn,
        nameAr: room.roomType.nameAr,
      },
    };
  }
}
