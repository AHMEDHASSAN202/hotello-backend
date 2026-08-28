import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsService } from '../hotels/tenant-urls.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { BulkCommitDto, RoomRowDto } from './dto/bulk-commit.dto';
import { BulkPreviewDto } from './dto/bulk-preview.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomQrService } from './room-qr.service';
import { RoomRowInput } from './room-rows';
import { Room } from './room.entity';
import { RoomType } from './room-type.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { NATURAL_ROOM_ORDER, TenantRoomsService } from './tenant-rooms.service';
import { parseImport } from './xlsx/parse-import';

// Story 11.7 — `parseImport` is a standalone pure function (xlsx/parse-import.ts,
// not a RoomsXlsxService method — keeps TenantRoomsService -> RoomsXlsxService
// a one-directional, non-circular dependency), so it's mocked at the module
// level rather than via a DI provider.
jest.mock('./xlsx/parse-import');
const mockedParseImport = parseImport as jest.MockedFunction<typeof parseImport>;

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
  let roomTypesRepo: { find: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let staysRepo: { find: jest.Mock; findOne: jest.Mock; exists: jest.Mock };
  let managerStays: { findOne: jest.Mock };
  let subscriptions: { getForHotel: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let tenantUrls: { buildGuestUrl: jest.Mock };
  let roomQr: { generate: jest.Mock };
  let qb: Record<string, jest.Mock>;

  // Transaction manager wiring for createRoom (11.3) — configurable countable
  // room count per test.
  let countable: number;
  let usersRepo: { findOne: jest.Mock };
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
    for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'skip', 'take']) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getCount = jest.fn().mockResolvedValue(0);
    qb.getMany = jest.fn().mockResolvedValue([]);

    roomsRepo = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
    };
    roomTypesRepo = { find: jest.fn().mockResolvedValue([]) };
    hotelsRepo = { findOne: jest.fn() };
    staysRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      exists: jest.fn().mockResolvedValue(false),
    };
    usersRepo = { findOne: jest.fn().mockResolvedValue(null) };
    managerStays = { findOne: jest.fn().mockResolvedValue(null) };
    subscriptions = { getForHotel: jest.fn() };
    auditLogs = { log: jest.fn() };
    tenantUrls = {
      buildGuestUrl: jest.fn(
        (slug: string, params?: Record<string, string>) =>
          params
            ? `https://guest.gxp.example/${slug}?${new URLSearchParams(params).toString()}`
            : `https://guest.gxp.example/${slug}`,
      ),
    };
    roomQr = {
      generate: jest.fn(async () => ({
        body: Buffer.from('fake'),
        contentType: 'image/png',
      })),
    };
    mockedParseImport.mockReset();

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
        if (entity === Stay) return managerStays;
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
        { provide: getRepositoryToken(RoomType), useValue: roomTypesRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(TenantUser), useValue: usersRepo },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: TenantUrlsService, useValue: tenantUrls },
        { provide: RoomQrService, useValue: roomQr },
      ],
    }).compile();
    service = moduleRef.get(TenantRoomsService);
  });

  describe('NATURAL_ROOM_ORDER (11.2 — data-triggered 500 regression)', () => {
    it('casts the numeric prefix to ::numeric, not ::bigint (a 20-digit all-numeric room number — allowed by the roomNumber regex — overflows bigint and 500s)', () => {
      expect(NATURAL_ROOM_ORDER).toContain('::numeric');
      expect(NATURAL_ROOM_ORDER).not.toContain('::bigint');
    });
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
      qb.getCount.mockResolvedValue(1);
      qb.getMany.mockResolvedValue(rooms);
      roomTypesRepo.find.mockResolvedValue([
        { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
      ]);

      const result = await service.list(HOTEL_ID, {
        page: 2,
        pageSize: 10,
      } as ListRoomsQueryDto);

      expect(roomsRepo.createQueryBuilder).toHaveBeenCalledWith('r');
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

    it('AC2 — never joins roomType into the paginated query (real-Postgres regression: join + skip/take + raw orderBy 500s)', async () => {
      qb.getMany.mockResolvedValue([makeRoom()]);
      roomTypesRepo.find.mockResolvedValue([
        { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
      ]);

      await service.list(HOTEL_ID, {} as ListRoomsQueryDto);

      expect(qb.leftJoinAndSelect).toBeUndefined();
      expect(roomTypesRepo.find).toHaveBeenCalledWith({
        where: { id: In(['rt-1']) },
      });
    });

    it('AC2 — page with zero rooms never calls roomTypesRepo.find', async () => {
      qb.getMany.mockResolvedValue([]);

      await service.list(HOTEL_ID, {} as ListRoomsQueryDto);

      expect(roomTypesRepo.find).not.toHaveBeenCalled();
    });

    it('AC2 — takes the total count BEFORE any orderBy is applied (getManyAndCount 500s on the raw-SQL natural-order expression against real Postgres)', async () => {
      const callOrder: string[] = [];
      qb.getCount.mockImplementation(async () => {
        callOrder.push('getCount');
        return 0;
      });
      qb.orderBy.mockImplementation(() => {
        callOrder.push('orderBy');
        return qb;
      });
      qb.getMany.mockImplementation(async () => {
        callOrder.push('getMany');
        return [];
      });

      await service.list(HOTEL_ID, {} as ListRoomsQueryDto);

      expect(callOrder).toEqual(['getCount', 'orderBy', 'getMany']);
      expect(qb.getManyAndCount).toBeUndefined();
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

  describe('listAllForExport (11.7)', () => {
    it('AC1 — scopes by hotelId, applies the same filters as list(), and never skip/take (exports everything matching)', async () => {
      qb.getMany.mockResolvedValue([makeRoom()]);
      roomTypesRepo.find.mockResolvedValue([
        { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
      ]);

      await service.listAllForExport(HOTEL_ID, {
        floor: 3,
        typeId: 'rt-1',
        status: 'active',
        search: '  lobby  ',
      } as ListRoomsQueryDto);

      expect(roomsRepo.createQueryBuilder).toHaveBeenCalledWith('r');
      expect(qb.where).toHaveBeenCalledWith('r.hotelId = :hotelId', {
        hotelId: HOTEL_ID,
      });
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
      expect(qb.skip).not.toHaveBeenCalled();
      expect(qb.take).not.toHaveBeenCalled();
    });

    it('AC1 — orders by floor NULLS LAST, then the natural numeric prefix, then roomNumber (same order as list())', async () => {
      await service.listAllForExport(HOTEL_ID, {} as ListRoomsQueryDto);

      expect(qb.orderBy).toHaveBeenCalledWith('r.floor', 'ASC', 'NULLS LAST');
      expect(qb.addOrderBy).toHaveBeenNthCalledWith(
        1,
        NATURAL_ROOM_ORDER,
        'ASC',
        'NULLS LAST',
      );
      expect(qb.addOrderBy).toHaveBeenNthCalledWith(2, 'r.roomNumber', 'ASC');
    });

    it('AC1 — never joins roomType; batch-loads types for the whole result set (same no-join discipline as list())', async () => {
      qb.getMany.mockResolvedValue([makeRoom(), makeRoom({ id: 'room-2', roomTypeId: 'rt-2' })]);
      roomTypesRepo.find.mockResolvedValue([
        { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
        { id: 'rt-2', nameEn: 'Deluxe', nameAr: 'ديلوكس' },
      ]);

      const rows = await service.listAllForExport(HOTEL_ID, {} as ListRoomsQueryDto);

      expect(qb.leftJoinAndSelect).toBeUndefined();
      expect(roomTypesRepo.find).toHaveBeenCalledWith({
        where: { id: In(['rt-1', 'rt-2']) },
      });
      expect(rows[0].roomType).toEqual({ id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' });
      expect(rows[1].roomType).toEqual({ id: 'rt-2', nameEn: 'Deluxe', nameAr: 'ديلوكس' });
    });

    it('AC1 — zero matches never calls roomTypesRepo.find and returns []', async () => {
      qb.getMany.mockResolvedValue([]);

      const rows = await service.listAllForExport(HOTEL_ID, {} as ListRoomsQueryDto);

      expect(roomTypesRepo.find).not.toHaveBeenCalled();
      expect(rows).toEqual([]);
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

  describe('detail (11.2/11.5)', () => {
    it('maps the room + roomType relation to a RoomView', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, slug: 'sunrise' });
      const result = await service.detail(HOTEL_ID, 'room-1');
      expect(result).toEqual({
        id: 'room-1',
        roomNumber: '101',
        floor: 1,
        status: 'active',
        roomType: { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
        guestUrl: 'https://guest.gxp.example/sunrise?room=101',
      });
    });

    it('AC4 — builds guestUrl from the hotel slug + room number, never client input', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, slug: 'sunrise' });
      await service.detail(HOTEL_ID, 'room-1');
      expect(tenantUrls.buildGuestUrl).toHaveBeenCalledWith('sunrise', {
        room: '101',
      });
    });

    it('other hotel’s room id → 404 ROOM_NOT_FOUND', async () => {
      roomsRepo.findOne.mockResolvedValue(null);
      await expect(service.detail(HOTEL_ID, 'room-x')).rejects.toMatchObject({
        response: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
      });
    });
  });

  describe('generalQr (11.5)', () => {
    it('AC3/AC4 — builds the general guest URL and delegates to RoomQrService', async () => {
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, slug: 'sunrise' });
      const result = await service.generalQr(HOTEL_ID, 'png');
      expect(tenantUrls.buildGuestUrl).toHaveBeenCalledWith('sunrise');
      expect(roomQr.generate).toHaveBeenCalledWith(
        'https://guest.gxp.example/sunrise',
        'png',
      );
      expect(result.contentType).toBe('image/png');
    });

    it('unknown hotel → 404 HOTEL_NOT_FOUND', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(service.generalQr(HOTEL_ID, 'png')).rejects.toMatchObject({
        response: { code: 'HOTEL_NOT_FOUND' },
      });
    });
  });

  describe('roomQr (11.5)', () => {
    it('AC3/AC4 — builds the room guest URL (?room=) and delegates to RoomQrService', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, slug: 'sunrise' });
      const result = await service.roomQr(HOTEL_ID, 'room-1', 'svg');
      expect(tenantUrls.buildGuestUrl).toHaveBeenCalledWith('sunrise', {
        room: '101',
      });
      expect(roomQr.generate).toHaveBeenCalledWith(
        'https://guest.gxp.example/sunrise?room=101',
        'svg',
      );
      expect(result.filename).toBe('room-101.svg');
    });

    it('cross-tenant room id → 404 ROOM_NOT_FOUND (QR never confirms other tenants)', async () => {
      roomsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.roomQr(HOTEL_ID, 'room-x', 'png'),
      ).rejects.toMatchObject({
        response: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
      });
      expect(roomQr.generate).not.toHaveBeenCalled();
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

  describe('importPreview (11.7)', () => {
    const makeFile = (o: Partial<Express.Multer.File> = {}): Express.Multer.File =>
      ({
        originalname: 'rooms-import.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from('fake-xlsx-bytes'),
        size: 1024,
        ...o,
      }) as Express.Multer.File;

    beforeEach(() => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 50 } },
      });
      roomTypesRepo.find.mockResolvedValue([
        { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
      ]);
      managerRoomTypes.find.mockResolvedValue([{ id: 'rt-1' }]);
      managerRooms.find.mockResolvedValue([]);
      countable = 0;
    });

    it('AC4 — per-row issues carry the spreadsheet row number and field (duplicate/unknown type/bad status/empty required)', async () => {
      mockedParseImport.mockResolvedValue({
        rows: [
          { row: 2, roomNumber: '301', floor: 1, roomTypeId: 'rt-1', status: 'active' },
          { row: 3, roomNumber: '301', floor: 1, roomTypeId: 'rt-1', status: 'active' },
          { row: 4, roomNumber: '', floor: null, roomTypeId: 'rt-1', status: 'active' },
          { row: 5, roomNumber: '303', floor: null, roomTypeId: 'rt-ghost', status: 'active' },
          // 'weird' is intentionally not a valid status — exercises the
          // INVALID_STATUS branch; parseImport itself would pass unmatched
          // status text through as-is (see parse-import.ts), hence the cast.
          { row: 6, roomNumber: '304', floor: null, roomTypeId: 'rt-1', status: 'weird' },
        ] as unknown as RoomRowInput[],
        skippedExampleRows: 3,
      });

      const file = makeFile();
      const result = await service.importPreview(makeActor(), file);

      expect(mockedParseImport).toHaveBeenCalledWith(file.buffer, [
        { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
      ]);
      expect(result.rows).toEqual([
        expect.objectContaining({ row: 2, issues: [] }),
        expect.objectContaining({
          row: 3,
          duplicate: true,
          issues: [{ row: 3, field: 'roomNumber', code: 'DUPLICATE_IN_FILE' }],
        }),
        expect.objectContaining({
          row: 4,
          issues: [{ row: 4, field: 'roomNumber', code: 'REQUIRED' }],
        }),
        expect.objectContaining({
          row: 5,
          issues: [{ row: 5, field: 'roomTypeId', code: 'UNKNOWN_TYPE' }],
        }),
        expect.objectContaining({
          row: 6,
          issues: [{ row: 6, field: 'status', code: 'INVALID_STATUS' }],
        }),
      ]);
    });

    it('surfaces skippedExampleRows so the UI can explain a 0-valid preview when users keep the # marker on the example rows', async () => {
      // Real support case: the user typed their rooms over the template's
      // example rows but kept the leading '#', so every row was skipped.
      mockedParseImport.mockResolvedValue({ rows: [], skippedExampleRows: 3 });

      const result = await service.importPreview(makeActor(), makeFile());

      expect(result.validCount).toBe(0);
      expect(result.rows).toEqual([]);
      expect(result.skippedExampleRows).toBe(3);
    });

    it('AC4 — returns remaining plan seats like the range preview', async () => {
      countable = 10;
      mockedParseImport.mockResolvedValue({
        rows: [{ row: 2, roomNumber: '301', floor: null, roomTypeId: 'rt-1', status: 'active' }],
        skippedExampleRows: 0,
      });

      const result = await service.importPreview(makeActor(), makeFile());

      expect(result.validCount).toBe(1);
      expect(result.remaining).toBe(40);
    });

    it('AC5 — non-xlsx upload (wrong magic/extension) → 400 IMPORT_FILE_INVALID with a clear message', async () => {
      const badFile = makeFile({ originalname: 'rooms.csv', mimetype: 'text/csv' });

      await expect(
        service.importPreview(makeActor(), badFile),
      ).rejects.toMatchObject({
        response: { code: 'IMPORT_FILE_INVALID', message: expect.any(String) },
      });
      expect(mockedParseImport).not.toHaveBeenCalled();
    });

    it('AC5 — no file uploaded → 400 IMPORT_FILE_INVALID', async () => {
      await expect(
        service.importPreview(makeActor(), undefined as unknown as Express.Multer.File),
      ).rejects.toMatchObject({
        response: { code: 'IMPORT_FILE_INVALID' },
      });
      expect(mockedParseImport).not.toHaveBeenCalled();
    });

    it('IMPORT_TOO_MANY_ROWS from parseImport propagates unchanged', async () => {
      mockedParseImport.mockRejectedValue({
        response: { code: 'IMPORT_TOO_MANY_ROWS' },
      });

      await expect(
        service.importPreview(makeActor(), makeFile()),
      ).rejects.toMatchObject({ response: { code: 'IMPORT_TOO_MANY_ROWS' } });
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

    it('AC4 — locks the hotel row BEFORE reading existing room numbers (race guard: a concurrent commit or createRoom must not read a pre-insert snapshot)', async () => {
      const callOrder: string[] = [];
      managerHotel.findOne.mockImplementation(
        async (opts: Record<string, unknown>) => {
          if (opts?.lock) callOrder.push('lock');
          return { id: HOTEL_ID, roomsCount: 0 };
        },
      );
      managerRooms.find.mockImplementation(async () => {
        callOrder.push('existingNumbers');
        return [];
      });

      await service.bulkCommit(makeActor(), {
        rooms: makeRows(['301']),
        source: 'range',
      } as BulkCommitDto);

      expect(callOrder).toEqual(['lock', 'existingNumbers']);
      expect(managerHotel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: HOTEL_ID },
          lock: { mode: 'pessimistic_write' },
        }),
      );
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

    it('preview/commit parity — a row that is BOTH a duplicate AND has another issue (e.g. UNKNOWN_TYPE), skipDuplicates=true → commit succeeds, the dual-issue row is silently skipped as a duplicate, nothing 400s', async () => {
      countable = 1;
      managerRooms.find.mockResolvedValue([{ roomNumber: '302' }]);
      managerHotel.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 1 });

      const rows = makeRows(['301', '302']);
      rows[1] = { ...rows[1], roomTypeId: 'rt-ghost' } as RoomRowDto;

      const result = await service.bulkCommit(makeActor(), {
        rooms: rows,
        source: 'range',
        skipDuplicates: true,
      } as BulkCommitDto);

      expect(result).toEqual({ created: 1, skipped: 1 });
      expect(manager.save).toHaveBeenCalledWith(Room, [
        expect.objectContaining({ roomNumber: '301' }),
      ]);
    });

    it('preview/commit parity — the SAME dual-issue duplicate row with skipDuplicates=false (or omitted) still 409s ROOM_NUMBER_TAKEN, not 400 BULK_ROWS_INVALID', async () => {
      managerRooms.find.mockResolvedValue([{ roomNumber: '302' }]);

      const rows = makeRows(['301', '302']);
      rows[1] = { ...rows[1], roomTypeId: 'rt-ghost' } as RoomRowDto;

      await expect(
        service.bulkCommit(makeActor(), {
          rooms: rows,
          source: 'range',
        } as BulkCommitDto),
      ).rejects.toMatchObject({
        response: { code: 'ROOM_NUMBER_TAKEN' },
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

  describe('updateRoom (11.4)', () => {
    const baseRoom = (o: Record<string, unknown> = {}) => ({
      id: 'room-1',
      hotelId: HOTEL_ID,
      roomNumber: '101',
      floor: 1,
      roomTypeId: 'rt-1',
      status: 'active',
      roomType: { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
      ...o,
    });

    beforeEach(() => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 50 } },
      });
      managerHotel.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 3 });
      managerRoomTypes.findOne.mockResolvedValue({
        id: 'rt-2',
        hotelId: HOTEL_ID,
        nameEn: 'Deluxe',
        nameAr: 'ديلوكس',
      });
      // findOne on the manager's Room repo serves two purposes here: loading
      // the room-under-edit (queried by id) and the roomNumber dupe check
      // (queried by roomNumber, no id) — branch on which shape was asked for.
      managerRooms.findOne.mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id) return baseRoom();
          return null;
        },
      );
    });

    it('AC1 — edits floor/type/status; audits room.updated with field-level diff', async () => {
      countable = 3; // active -> out_of_service: still countable either way

      const result = await service.updateRoom(makeActor(), 'room-1', {
        floor: 4,
        roomTypeId: 'rt-2',
        status: 'out_of_service',
      } as UpdateRoomDto);

      expect(result).toMatchObject({
        floor: 4,
        status: 'out_of_service',
        roomType: { id: 'rt-2', nameEn: 'Deluxe' },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'room.updated',
          entityType: 'room',
          entityId: 'room-1',
          actorId: 'actor-1',
          metadata: {
            actorType: 'tenant_user',
            hotelId: HOTEL_ID,
            diff: {
              floor: { from: 1, to: 4 },
              roomTypeId: { from: 'rt-1', to: 'rt-2' },
              status: { from: 'active', to: 'out_of_service' },
            },
          },
        }),
      );
    });

    it('AC1 — renumber allowed while hasStayHistory() is false; normalized + uniqueness-checked (409 ROOM_NUMBER_TAKEN)', async () => {
      countable = 3;

      const result = await service.updateRoom(makeActor(), 'room-1', {
        roomNumber: ' 202b ',
      } as UpdateRoomDto);

      expect(result.roomNumber).toBe('202B');
      expect(managerRooms.save).toHaveBeenCalledWith(
        expect.objectContaining({ roomNumber: '202B' }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            diff: { roomNumber: { from: '101', to: '202B' } },
          }),
        }),
      );

      // Now the target number is already taken by another room in the hotel.
      managerRooms.findOne.mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id) return baseRoom();
          return { id: 'other-room', roomNumber: '303' };
        },
      );

      await expect(
        service.updateRoom(makeActor(), 'room-1', {
          roomNumber: '303',
        } as UpdateRoomDto),
      ).rejects.toMatchObject({
        response: { code: 'ROOM_NUMBER_TAKEN', roomNumber: '303' },
      });
    });

    it('AC2 — active → inactive frees a seat: hotels.roomsCount recomputed inside the tx', async () => {
      countable = 2; // after saving, this room no longer counts

      await service.updateRoom(makeActor(), 'room-1', {
        status: 'inactive',
      } as UpdateRoomDto);

      expect(managerHotel.save).toHaveBeenCalledWith(
        expect.objectContaining({ roomsCount: 2 }),
      );
    });

    it('AC2 — inactive → active re-checks the plan limit in-tx and can 409 ROOM_LIMIT_REACHED (re-enable discipline)', async () => {
      managerRooms.findOne.mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id) return baseRoom({ status: 'inactive' });
          return null;
        },
      );
      countable = 5;
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 5 } },
      });

      await expect(
        service.updateRoom(makeActor(), 'room-1', {
          status: 'active',
        } as UpdateRoomDto),
      ).rejects.toMatchObject({
        response: {
          code: 'ROOM_LIMIT_REACHED',
          limit: 5,
          used: 5,
          remaining: 0,
        },
      });

      expect(managerRooms.save).not.toHaveBeenCalled();
      expect(managerHotel.save).not.toHaveBeenCalled();
    });

    it('AC2 — locks the hotel BEFORE counting countable rooms when reactivating (race guard)', async () => {
      managerRooms.findOne.mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id) return baseRoom({ status: 'inactive' });
          return null;
        },
      );
      const callOrder: string[] = [];
      managerHotel.findOne.mockImplementation(
        async (opts: Record<string, unknown>) => {
          if (opts?.lock) callOrder.push('lock');
          return { id: HOTEL_ID, roomsCount: 3 };
        },
      );
      const spyQb = countQb();
      const rawGetCount = spyQb.getCount;
      spyQb.getCount = jest.fn(async () => {
        callOrder.push('count');
        return rawGetCount();
      });
      managerRooms.createQueryBuilder.mockReturnValue(spyQb);
      countable = 2;

      await service.updateRoom(makeActor(), 'room-1', {
        status: 'active',
      } as UpdateRoomDto);

      expect(callOrder[0]).toEqual('lock');
      expect(callOrder).toContain('count');
    });

    it('AC2 — active → out_of_service does NOT change the countable total (no limit re-check needed)', async () => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 4 } },
      });
      managerHotel.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 4 });
      countable = 4; // at the limit already — a lateral transition must not trip it

      await expect(
        service.updateRoom(makeActor(), 'room-1', {
          status: 'out_of_service',
        } as UpdateRoomDto),
      ).resolves.toBeDefined();

      expect(managerHotel.save).toHaveBeenCalledWith(
        expect.objectContaining({ roomsCount: 4 }),
      );
    });

    it('cross-tenant id → 404 ROOM_NOT_FOUND', async () => {
      managerRooms.findOne.mockResolvedValue(null);

      await expect(
        service.updateRoom(makeActor(), 'room-x', {
          floor: 2,
        } as UpdateRoomDto),
      ).rejects.toMatchObject({ response: { code: 'ROOM_NOT_FOUND' } });
    });

    it('unknown target type → 404 ROOM_TYPE_NOT_FOUND', async () => {
      managerRoomTypes.findOne.mockResolvedValue(null);

      await expect(
        service.updateRoom(makeActor(), 'room-1', {
          roomTypeId: 'rt-ghost',
        } as UpdateRoomDto),
      ).rejects.toMatchObject({ response: { code: 'ROOM_TYPE_NOT_FOUND' } });
    });

    it('no actual changes → no audit log written', async () => {
      countable = 3;

      await service.updateRoom(makeActor(), 'room-1', {
        floor: 1,
        status: 'active',
      } as UpdateRoomDto);

      expect(auditLogs.log).not.toHaveBeenCalled();
      expect(managerRooms.save).not.toHaveBeenCalled();
      expect(managerHotel.save).not.toHaveBeenCalled();
    });

    it('audits room.updated only after the transaction commits, never inside it', async () => {
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
      countable = 3;

      await service.updateRoom(makeActor(), 'room-1', {
        floor: 9,
      } as UpdateRoomDto);

      expect(callOrder).toEqual(['commit', 'audit']);
    });
  });

  describe('stays integration (Epic 13)', () => {
    const baseRoom = (o: Record<string, unknown> = {}) => ({
      id: 'room-1',
      hotelId: HOTEL_ID,
      roomNumber: '101',
      floor: 1,
      roomTypeId: 'rt-1',
      status: 'active',
      roomType: { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
      ...o,
    });

    beforeEach(() => {
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxRooms: 50 } },
      });
      managerHotel.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 3 });
      managerRooms.findOne.mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id) return baseRoom();
          return null;
        },
      );
      managerRooms.save = jest.fn(async (r: unknown) => r);
    });

    it('hasStayHistory delegates to a stays existence query', async () => {
      staysRepo.exists.mockResolvedValue(true);
      await expect(service.hasStayHistory('room-1')).resolves.toBe(true);
      expect(staysRepo.exists).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
      });
    });

    it('11.4 AC1 — renumbering a room with stay history THROWS (no silent skip)', async () => {
      staysRepo.exists.mockResolvedValue(true);
      await expect(
        service.updateRoom(makeActor(), 'room-1', {
          roomNumber: '999',
        } as UpdateRoomDto),
      ).rejects.toMatchObject({
        response: { code: 'ROOM_HAS_STAY_HISTORY' },
      });
      expect(managerRooms.save).not.toHaveBeenCalled();
    });

    it('11.4 AC2 — an occupied room cannot leave active (409 ROOM_OCCUPIED)', async () => {
      managerStays.findOne.mockResolvedValue({ id: 'stay-1' });
      await expect(
        service.updateRoom(makeActor(), 'room-1', {
          status: 'out_of_service',
        } as UpdateRoomDto),
      ).rejects.toMatchObject({ response: { code: 'ROOM_OCCUPIED' } });
      // The occupancy check ran inside the locked transaction.
      expect(managerStays.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roomId: 'room-1', status: 'active' },
        }),
      );
    });

    it('a vacant room still transitions normally', async () => {
      managerStays.findOne.mockResolvedValue(null);
      const result = await service.updateRoom(makeActor(), 'room-1', {
        status: 'out_of_service',
      } as UpdateRoomDto);
      expect(result.status).toEqual('out_of_service');
    });

    describe('occupancy on the rooms list (13.2 AC3)', () => {
      beforeEach(() => {
        hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, roomsCount: 12 });
        qb.getCount.mockResolvedValue(2);
        qb.getMany.mockResolvedValue([
          makeRoom(),
          makeRoom({ id: 'room-2', roomNumber: '102' }),
        ]);
        roomTypesRepo.find.mockResolvedValue([
          { id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' },
        ]);
      });

      it('batch-loads active stays in ONE query and maps occupied/vacant', async () => {
        staysRepo.find.mockResolvedValue([
          {
            id: 'stay-1',
            roomId: 'room-1',
            guestName: 'Ahmed Ali',
            checkOutDate: '2026-08-25',
            status: 'active',
          },
        ]);

        const result = await service.list(
          HOTEL_ID,
          {} as ListRoomsQueryDto,
          true,
        );

        expect(staysRepo.find).toHaveBeenCalledTimes(1);
        expect(result.data[0].currentStay).toEqual({
          id: 'stay-1',
          guestName: 'Ahmed Ali',
          checkOutDate: '2026-08-25',
        });
        expect(result.data[1].currentStay).toBeNull();
      });

      it('without stays.read the field is absent and no stays query runs', async () => {
        const result = await service.list(
          HOTEL_ID,
          {} as ListRoomsQueryDto,
          false,
        );
        expect(staysRepo.find).not.toHaveBeenCalled();
        expect('currentStay' in result.data[0]).toBe(false);
      });
    });

    it('detail exposes the current stay only with occupancy access', async () => {
      roomsRepo.findOne.mockResolvedValue(baseRoom());
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, slug: 'sunrise' });
      staysRepo.findOne.mockResolvedValue({
        id: 'stay-1',
        roomId: 'room-1',
        guestName: 'Ahmed Ali',
        checkOutDate: '2026-08-25',
        status: 'active',
      });

      const withAccess = await service.detail(HOTEL_ID, 'room-1', true);
      expect(withAccess.currentStay).toEqual({
        id: 'stay-1',
        guestName: 'Ahmed Ali',
        checkOutDate: '2026-08-25',
      });

      const withoutAccess = await service.detail(HOTEL_ID, 'room-1', false);
      expect('currentStay' in withoutAccess).toBe(false);
    });

    it('detail exposes the last-cleaned line only with housekeeping.read (20.3 AC3)', async () => {
      roomsRepo.findOne.mockResolvedValue({
        ...baseRoom(),
        housekeepingStatus: 'clean',
        cleaningType: null,
        lastCleanedAt: new Date('2026-08-29T08:00:00Z'),
        lastCleanedById: 'user-9',
      });
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, slug: 'sunrise' });
      usersRepo.findOne.mockResolvedValue({ id: 'user-9', name: 'Mona' });

      const withAccess = await service.detail(HOTEL_ID, 'room-1', false, true);
      expect(withAccess.housekeeping).toEqual({
        housekeepingStatus: 'clean',
        cleaningType: null,
        lastCleanedAt: new Date('2026-08-29T08:00:00Z'),
        lastCleanedBy: { id: 'user-9', name: 'Mona' },
      });

      const withoutAccess = await service.detail(HOTEL_ID, 'room-1', false, false);
      expect('housekeeping' in withoutAccess).toBe(false);
      expect(usersRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });
});
