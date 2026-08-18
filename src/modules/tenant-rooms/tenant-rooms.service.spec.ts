import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { Room } from './room.entity';
import { NATURAL_ROOM_ORDER, TenantRoomsService } from './tenant-rooms.service';

const HOTEL_ID = 'hotel-1';

const makeRoom = (o: Record<string, unknown> = {}) => ({
  id: 'room-1',
  hotelId: HOTEL_ID,
  roomNumber: '101',
  floor: 1,
  status: 'active',
  roomTypeId: 'rt-1',
  roomType: { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
  ...o,
});

describe('TenantRoomsService', () => {
  let service: TenantRoomsService;
  let roomsRepo: { createQueryBuilder: jest.Mock; findOne: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let subscriptions: { getForHotel: jest.Mock };
  let qb: Record<string, jest.Mock>;

  beforeEach(async () => {
    qb = {};
    for (const method of [
      'leftJoinAndSelect',
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);

    roomsRepo = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
    };
    hotelsRepo = { findOne: jest.fn() };
    subscriptions = { getForHotel: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRoomsService,
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();
    service = moduleRef.get(TenantRoomsService);
  });

  describe('list (11.2)', () => {
    beforeEach(() => {
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 12 });
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 50 } },
      });
    });

    it('AC2 — scopes by hotelId and paginates { data, total, page, pageSize }', async () => {
      const rooms = [makeRoom()];
      qb.getManyAndCount.mockResolvedValue([rooms, 1]);

      const result = await service.list(HOTEL_ID, {
        page: 2,
        pageSize: 10,
      } as ListRoomsQueryDto);

      expect(roomsRepo.createQueryBuilder).toHaveBeenCalledWith('r');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('r.roomType', 'type');
      expect(qb.where).toHaveBeenCalledWith('r.hotelId = :hotelId', {
        hotelId: HOTEL_ID,
      });
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result.total).toBe(1);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(result.data).toEqual([
        {
          id: 'room-1',
          roomNumber: '101',
          floor: 1,
          status: 'active',
          roomType: { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
        },
      ]);
    });

    it('AC2 — applies floor/type/status filters and roomNumber ILIKE search only when present', async () => {
      await service.list(HOTEL_ID, {
        floor: 3,
        typeId: 'rt-1',
        status: 'active',
        search: '  lobby  ',
      } as ListRoomsQueryDto);

      expect(qb.andWhere).toHaveBeenCalledWith('r.floor = :floor', {
        floor: 3,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('r.roomTypeId = :typeId', {
        typeId: 'rt-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('r.status = :status', {
        status: 'active',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('r."roomNumber" ILIKE :q', {
        q: '%LOBBY%',
      });
    });

    it('AC2 — omits filters entirely when none are given', async () => {
      await service.list(HOTEL_ID, {} as ListRoomsQueryDto);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('AC2 — orders by floor NULLS LAST, then numeric prefix of roomNumber, then roomNumber', async () => {
      await service.list(HOTEL_ID, {} as ListRoomsQueryDto);

      expect(qb.orderBy).toHaveBeenCalledWith('r.floor', 'ASC', 'NULLS LAST');
      expect(qb.addOrderBy).toHaveBeenNthCalledWith(
        1,
        NATURAL_ROOM_ORDER,
        'ASC',
        'NULLS LAST',
      );
      expect(qb.addOrderBy).toHaveBeenNthCalledWith(2, 'r.roomNumber', 'ASC');
    });

    it('AC3 — returns usage { used: hotel.roomsCount, max: plan.maxRooms }', async () => {
      const result = await service.list(HOTEL_ID, {} as ListRoomsQueryDto);
      expect(result.usage).toEqual({ used: 12, max: 50 });
    });

    it('AC3 — max is null when the plan is unlimited', async () => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: null } },
      });
      const result = await service.list(HOTEL_ID, {} as ListRoomsQueryDto);
      expect(result.usage.max).toBeNull();
    });

    it('AC3 — max is null when there is no active subscription', async () => {
      subscriptions.getForHotel.mockResolvedValue({ current: null });
      const result = await service.list(HOTEL_ID, {} as ListRoomsQueryDto);
      expect(result.usage.max).toBeNull();
    });
  });

  describe('findRoomInHotel (11.2)', () => {
    it('AC1/isolation — other hotel’s room id → 404 ROOM_NOT_FOUND', async () => {
      roomsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findRoomInHotel(HOTEL_ID, 'room-x'),
      ).rejects.toMatchObject({
        response: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
      });
      expect(roomsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'room-x', hotelId: HOTEL_ID },
        relations: ['roomType'],
      });
    });

    it('returns the room when it belongs to the hotel', async () => {
      const room = makeRoom();
      roomsRepo.findOne.mockResolvedValue(room);
      await expect(
        service.findRoomInHotel(HOTEL_ID, 'room-1'),
      ).resolves.toBe(room);
    });
  });

  describe('detail (11.2)', () => {
    it('maps the room + roomType relation to a RoomView', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
      const result = await service.detail(HOTEL_ID, 'room-1');
      expect(result).toEqual({
        id: 'room-1',
        roomNumber: '101',
        floor: 1,
        status: 'active',
        roomType: { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
      });
    });
  });

  describe('roomsLimit (11.2)', () => {
    it('reads plan.maxRooms', async () => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 25 } },
      });
      await expect(service.roomsLimit(HOTEL_ID)).resolves.toBe(25);
    });
  });

  describe('countCountable (11.2)', () => {
    it('counts only active + out_of_service rooms via the given manager', async () => {
      const countQb: Record<string, jest.Mock> = {};
      for (const m of ['where', 'andWhere']) {
        countQb[m] = jest.fn().mockReturnValue(countQb);
      }
      countQb.getCount = jest.fn().mockResolvedValue(7);
      const manager = {
        getRepository: jest.fn(() => ({
          createQueryBuilder: jest.fn(() => countQb),
        })),
      } as unknown as EntityManager;

      const result = await service.countCountable(manager, HOTEL_ID);

      expect(countQb.where).toHaveBeenCalledWith('r.hotelId = :hotelId', {
        hotelId: HOTEL_ID,
      });
      expect(countQb.andWhere).toHaveBeenCalledWith(
        'r.status IN (:...statuses)',
        { statuses: ['active', 'out_of_service'] },
      );
      expect(result).toBe(7);
    });
  });
});
