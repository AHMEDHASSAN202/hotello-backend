import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { BulkCommitDto, RoomRowDto } from './dto/bulk-commit.dto';
import { BulkPreviewDto } from './dto/bulk-preview.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { Room } from './room.entity';
import { RoomType } from './room-type.entity';
import { NATURAL_ROOM_ORDER, TenantRoomsService } from './tenant-rooms.service';

const HOTEL_ID = 'hotel-1';

const makeActor = (o: Record<string, unknown> = {}): TenantUser =>
  ({ id: 'actor-1', hotelId: HOTEL_ID, name: 'Boss', ...o }) as unknown as TenantUser;

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
  let auditLogs: { log: jest.Mock };
  let qb: Record<string, jest.Mock>;

  // Transaction manager wiring for createRoom (11.3) — configurable countable
  // room count per test.
  let countable: number;
  let manager: { getRepository: jest.Mock; save: jest.Mock };
  let managerHotel: { findOne: jest.Mock; save: jest.Mock };
  let managerRoomTypes: { findOne: jest.Mock; find: jest.Mock };
  let managerRooms: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock; manager?: unknown };

  const countQb = () => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['where', 'andWhere']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getCount = jest.fn(async () => countable);
    return qb;
  };

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
    auditLogs = { log: jest.fn() };

    countable = 0;
    managerHotel = {
      findOne: jest.fn().mockResolvedValue({ id: HOTEL_ID, roomsCount: 0 }),
      save: jest.fn(async (h) => h),
    };
    managerRoomTypes = {
      findOne: jest.fn().mockResolvedValue({
        id: 'rt-1',
        hotelId: HOTEL_ID,
        nameEn: 'Standard',
        nameAr: 'قياسية',
      }),
      find: jest.fn().mockResolvedValue([{ id: 'rt-1' }]),
    };
    managerRooms = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((d) => ({ id: 'room-new', createdAt: new Date(), ...d })),
      save: jest.fn(async (r) => r),
      createQueryBuilder: jest.fn(() => countQb()),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Hotel) return managerHotel;
        if (entity === RoomType) return managerRoomTypes;
        return managerRooms;
      }),
      save: jest.fn(async (_entity: unknown, rows: unknown[]) => rows),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
      // bulkPreview (11.3) reads through the default (non-transactional)
      // manager — reuse the same fake repos so tests configure one place.
      manager,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRoomsService,
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditLogsService, useValue: auditLogs },
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

  describe('createRoom (11.3)', () => {
    beforeEach(() => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 50 } },
      });
    });

    it('AC1 — creates with normalized roomNumber (" 101a " → "101A"), default status active', async () => {
      const result = await service.createRoom(makeActor(), {
        roomNumber: ' 101a ',
        floor: 2,
        roomTypeId: 'rt-1',
      } as CreateRoomDto);

      expect(managerRooms.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelId: HOTEL_ID,
          roomNumber: '101A',
          floor: 2,
          roomTypeId: 'rt-1',
          status: 'active',
        }),
      );
      expect(result).toMatchObject({
        hotelId: HOTEL_ID,
        roomNumber: '101A',
        floor: 2,
        status: 'active',
        roomTypeId: 'rt-1',
        roomType: { id: 'rt-1', nameEn: 'Standard' },
      });
    });

    it('AC1 — duplicate number in the same hotel → 409 ROOM_NUMBER_TAKEN', async () => {
      managerRooms.findOne.mockResolvedValue({ id: 'existing', roomNumber: '101A' });

      await expect(
        service.createRoom(makeActor(), {
          roomNumber: '101a',
          roomTypeId: 'rt-1',
        } as CreateRoomDto),
      ).rejects.toMatchObject({
        response: { code: 'ROOM_NUMBER_TAKEN', roomNumber: '101A' },
      });
    });

    it('AC1 — same number in another hotel is fine (isolation)', async () => {
      await service.createRoom(makeActor(), {
        roomNumber: '101a',
        roomTypeId: 'rt-1',
      } as CreateRoomDto);

      // The dupe check is scoped to the actor's hotel — a matching number in
      // another hotel would never be looked up, let alone block creation.
      expect(managerRooms.findOne).toHaveBeenCalledWith({
        where: { hotelId: HOTEL_ID, roomNumber: '101A' },
      });
    });

    it('AC3 — at the limit (countable == maxRooms) → 409 ROOM_LIMIT_REACHED { limit, used }', async () => {
      countable = 5;
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 5 } },
      });

      await expect(
        service.createRoom(makeActor(), {
          roomNumber: '999',
          roomTypeId: 'rt-1',
        } as CreateRoomDto),
      ).rejects.toMatchObject({
        response: {
          code: 'ROOM_LIMIT_REACHED',
          limit: 5,
          used: 5,
          remaining: 0,
        },
      });
    });

    it('AC3 — inactive rooms do not count toward the limit', async () => {
      const spyQb = countQb();
      managerRooms.createQueryBuilder.mockReturnValue(spyQb);
      countable = 2; // countable rooms only — inactive rooms are excluded upstream
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 3 } },
      });

      await service.createRoom(makeActor(), {
        roomNumber: '5',
        roomTypeId: 'rt-1',
      } as CreateRoomDto);

      expect(spyQb.andWhere).toHaveBeenCalledWith('r.status IN (:...statuses)', {
        statuses: ['active', 'out_of_service'],
      });
    });

    it('AC3 — null maxRooms = unlimited, always passes', async () => {
      countable = 9999;
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: null } },
      });

      await expect(
        service.createRoom(makeActor(), {
          roomNumber: '5',
          roomTypeId: 'rt-1',
        } as CreateRoomDto),
      ).resolves.toBeDefined();
    });

    it('AC3 — count runs inside the transaction with a pessimistic hotel lock (race guard)', async () => {
      // Prove ordering, not just presence: the locked hotel fetch must
      // complete before the countable-rooms query runs, or a concurrent
      // create could count against a stale, unlocked snapshot.
      const callOrder: string[] = [];
      managerHotel.findOne.mockImplementation(async (opts: Record<string, unknown>) => {
        if (opts?.lock) callOrder.push('lock');
        return { id: HOTEL_ID, roomsCount: 0 };
      });
      const spyQb = countQb();
      const rawGetCount = spyQb.getCount;
      spyQb.getCount = jest.fn(async () => {
        callOrder.push('count');
        return rawGetCount();
      });
      managerRooms.createQueryBuilder.mockReturnValue(spyQb);

      await service.createRoom(makeActor(), {
        roomNumber: '5',
        roomTypeId: 'rt-1',
      } as CreateRoomDto);

      expect(callOrder).toEqual(['lock', 'count']);
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(managerHotel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: HOTEL_ID },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('keeps hotels.roomsCount in sync (used + 1) inside the tx', async () => {
      countable = 3;

      await service.createRoom(makeActor(), {
        roomNumber: '5',
        roomTypeId: 'rt-1',
      } as CreateRoomDto);

      expect(managerHotel.save).toHaveBeenCalledWith(
        expect.objectContaining({ roomsCount: 4 }),
      );
    });

    it('unknown roomTypeId in this hotel → 404 ROOM_TYPE_NOT_FOUND', async () => {
      managerRoomTypes.findOne.mockResolvedValue(null);

      await expect(
        service.createRoom(makeActor(), {
          roomNumber: '5',
          roomTypeId: 'rt-ghost',
        } as CreateRoomDto),
      ).rejects.toMatchObject({ response: { code: 'ROOM_TYPE_NOT_FOUND' } });
    });

    it('AC5 — audits room.created after commit', async () => {
      const callOrder: string[] = [];
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => unknown) => {
          const result = await cb(manager);
          callOrder.push('commit');
          return result;
        },
      );
      auditLogs.log.mockImplementation(async () => {
        callOrder.push('audit');
      });

      const result = await service.createRoom(makeActor(), {
        roomNumber: '5',
        roomTypeId: 'rt-1',
      } as CreateRoomDto);

      expect(callOrder).toEqual(['commit', 'audit']);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'room.created',
          entityType: 'room',
          entityId: result.id,
          actorId: 'actor-1',
          metadata: expect.objectContaining({
            actorType: 'tenant_user',
            hotelId: HOTEL_ID,
            roomNumber: '5',
          }),
        }),
      );
    });
  });

  describe('bulkPreview (11.3)', () => {
    beforeEach(() => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 50 } },
      });
      managerRoomTypes.find.mockResolvedValue([{ id: 'rt-1' }]);
      managerRooms.find.mockResolvedValue([]);
    });

    it('AC2 — returns per-number duplicate flags and remaining seats (limit − countable)', async () => {
      countable = 10;
      managerRooms.find.mockResolvedValue([{ roomNumber: '302' }]);

      const result = await service.bulkPreview(makeActor(), {
        from: 301,
        to: 303,
        roomTypeId: 'rt-1',
      } as BulkPreviewDto);

      expect(result.rows).toEqual([
        {
          row: 1,
          roomNumber: '301',
          floor: null,
          roomTypeId: 'rt-1',
          status: 'active',
          duplicate: false,
          issues: [],
        },
        {
          row: 2,
          roomNumber: '302',
          floor: null,
          roomTypeId: 'rt-1',
          status: 'active',
          duplicate: true,
          issues: [{ row: 2, field: 'roomNumber', code: 'DUPLICATE_IN_HOTEL' }],
        },
        {
          row: 3,
          roomNumber: '303',
          floor: null,
          roomTypeId: 'rt-1',
          status: 'active',
          duplicate: false,
          issues: [],
        },
      ]);
      expect(result.validCount).toBe(2);
      expect(result.duplicateCount).toBe(1);
      expect(result.invalidCount).toBe(0);
      expect(result.remaining).toBe(40);
    });

    it('AC2 — remaining is null on unlimited plans', async () => {
      countable = 999;
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: null } },
      });

      const result = await service.bulkPreview(makeActor(), {
        from: 1,
        to: 2,
        roomTypeId: 'rt-1',
      } as BulkPreviewDto);

      expect(result.remaining).toBeNull();
    });
  });

  describe('bulkCommit (11.3)', () => {
    const makeRows = (numbers: string[]): RoomRowDto[] =>
      numbers.map(
        (roomNumber, i) =>
          ({
            row: i + 1,
            roomNumber,
            roomTypeId: 'rt-1',
            status: 'active',
          }) as RoomRowDto,
      );

    beforeEach(() => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 50 } },
      });
      managerRoomTypes.find.mockResolvedValue([{ id: 'rt-1' }]);
      managerRooms.find.mockResolvedValue([]);
      countable = 0;
      managerHotel.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 0 });
    });

    it('AC4 — inserts all rows in ONE transaction and bumps hotels.roomsCount by created count', async () => {
      countable = 2;
      managerHotel.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 2 });

      const result = await service.bulkCommit(makeActor(), {
        rooms: makeRows(['301', '302', '303']),
        source: 'range',
        range: { from: 301, to: 303 },
      } as BulkCommitDto);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(
        Room,
        expect.arrayContaining([
          expect.objectContaining({ roomNumber: '301' }),
          expect.objectContaining({ roomNumber: '302' }),
          expect.objectContaining({ roomNumber: '303' }),
        ]),
      );
      expect(managerHotel.save).toHaveBeenCalledWith(
        expect.objectContaining({ roomsCount: 5 }),
      );
      expect(result).toEqual({ created: 3, skipped: 0 });
    });

    it('AC4 — a mid-flight duplicate with skipDuplicates=true is silently skipped (deterministic re-resolve)', async () => {
      countable = 1;
      managerRooms.find.mockResolvedValue([{ roomNumber: '302' }]);
      managerHotel.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 1 });

      const result = await service.bulkCommit(makeActor(), {
        rooms: makeRows(['301', '302', '303']),
        source: 'range',
        skipDuplicates: true,
        range: { from: 301, to: 303 },
      } as BulkCommitDto);

      expect(result).toEqual({ created: 2, skipped: 1 });
      expect(manager.save).toHaveBeenCalledWith(Room, [
        expect.objectContaining({ roomNumber: '301' }),
        expect.objectContaining({ roomNumber: '303' }),
      ]);
    });

    it('AC4 — a mid-flight duplicate with skipDuplicates=false → 409 ROOM_NUMBER_TAKEN and NOTHING is created', async () => {
      managerRooms.find.mockResolvedValue([{ roomNumber: '302' }]);

      await expect(
        service.bulkCommit(makeActor(), {
          rooms: makeRows(['301', '302', '303']),
          source: 'range',
          range: { from: 301, to: 303 },
        } as BulkCommitDto),
      ).rejects.toMatchObject({
        response: { code: 'ROOM_NUMBER_TAKEN' },
      });

      expect(manager.save).not.toHaveBeenCalled();
      expect(managerHotel.save).not.toHaveBeenCalled();
    });

    it('rows with other validation issues → 400 BULK_ROWS_INVALID { issues } and nothing created', async () => {
      const rows = makeRows(['301', '302']);
      rows[1] = { ...rows[1], roomTypeId: 'rt-ghost' } as RoomRowDto;

      await expect(
        service.bulkCommit(makeActor(), {
          rooms: rows,
          source: 'range',
        } as BulkCommitDto),
      ).rejects.toMatchObject({
        response: {
          code: 'BULK_ROWS_INVALID',
          issues: [{ row: 2, field: 'roomTypeId', code: 'UNKNOWN_TYPE' }],
        },
      });

      expect(manager.save).not.toHaveBeenCalled();
      expect(managerHotel.save).not.toHaveBeenCalled();
    });

    it('AC3 — final count over plan limit → 409 ROOM_LIMIT_REACHED { remaining } (bulk shows seats left)', async () => {
      countable = 4;
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 5 } },
      });

      await expect(
        service.bulkCommit(makeActor(), {
          rooms: makeRows(['301', '302']),
          source: 'range',
        } as BulkCommitDto),
      ).rejects.toMatchObject({
        response: { code: 'ROOM_LIMIT_REACHED', remaining: 1 },
      });

      expect(manager.save).not.toHaveBeenCalled();
    });

    it('AC5 — audits rooms.bulk_created with { count, range } for source range', async () => {
      const result = await service.bulkCommit(makeActor(), {
        rooms: makeRows(['301', '302']),
        source: 'range',
        range: { from: 301, to: 302 },
      } as BulkCommitDto);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rooms.bulk_created',
          entityType: 'room',
          entityId: HOTEL_ID,
          actorId: 'actor-1',
          metadata: expect.objectContaining({
            actorType: 'tenant_user',
            hotelId: HOTEL_ID,
            count: 2,
            skipped: 0,
            range: { from: 301, to: 302 },
            source: 'range',
          }),
        }),
      );
      expect(result).toEqual({ created: 2, skipped: 0 });
    });

    it('AC6(11.7) — audits rooms.imported with { created, skipped } for source import', async () => {
      await service.bulkCommit(makeActor(), {
        rooms: makeRows(['301', '302']),
        source: 'import',
      } as BulkCommitDto);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rooms.imported',
          metadata: expect.objectContaining({
            count: 2,
            skipped: 0,
            range: null,
            source: 'import',
          }),
        }),
      );
    });

    it('audits only after the transaction commits, never inside it', async () => {
      const callOrder: string[] = [];
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => unknown) => {
          const result = await cb(manager);
          callOrder.push('commit');
          return result;
        },
      );
      auditLogs.log.mockImplementation(async () => {
        callOrder.push('audit');
      });

      await service.bulkCommit(makeActor(), {
        rooms: makeRows(['301']),
        source: 'range',
      } as BulkCommitDto);

      expect(callOrder).toEqual(['commit', 'audit']);
    });
  });
});
