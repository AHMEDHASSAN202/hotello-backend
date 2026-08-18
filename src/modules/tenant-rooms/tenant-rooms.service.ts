import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { COUNTABLE_ROOM_STATUSES, Room } from './room.entity';

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

  private toRoomView(room: Room): RoomView {
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
