import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsService } from '../hotels/tenant-urls.service';
import { Room } from '../tenant-rooms/room.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateStayDto } from './dto/create-stay.dto';
import { StayCodeService } from './stay-code.service';
import { Stay } from './stay.entity';
import { hotelLocalParts } from './stay-time';
import { TenantStaysService, naturalRoomCompare } from './tenant-stays.service';

const HOTEL_ID = 'hotel-1';

const makeActor = (o: Record<string, unknown> = {}): TenantUser =>
  ({ id: 'actor-1', hotelId: HOTEL_ID, name: 'Desk', ...o }) as unknown as TenantUser;

const HOTEL = {
  id: HOTEL_ID,
  nameEn: 'Sunrise',
  nameAr: 'شروق',
  slug: 'sunrise',
  timezone: 'Africa/Cairo',
  checkoutTime: '12:00',
} as unknown as Hotel;

const ROOM = {
  id: 'room-1',
  hotelId: HOTEL_ID,
  roomNumber: '101',
  floor: 1,
  status: 'active',
} as unknown as Room;

const futureDate = (days: number): string => {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

const baseDto = (o: Partial<CreateStayDto> = {}): CreateStayDto =>
  ({
    guestName: 'Ahmed Ali',
    roomId: 'room-1',
    checkInDate: futureDate(0),
    checkOutDate: futureDate(3),
    language: 'ar',
    ...o,
  }) as CreateStayDto;

describe('TenantStaysService', () => {
  let service: TenantStaysService;
  let staysRepo: Record<string, jest.Mock>;
  let roomsRepo: Record<string, jest.Mock>;
  let hotelsRepo: Record<string, jest.Mock>;
  let auditLogs: { log: jest.Mock };
  let stayCodes: Record<string, jest.Mock>;
  let tenantUrls: { buildGuestUrl: jest.Mock };
  let events: { emitAsync: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let manager: { getRepository: jest.Mock };
  let managerHotel: Record<string, jest.Mock>;
  let managerRooms: Record<string, jest.Mock>;
  let managerStays: Record<string, jest.Mock>;
  let qb: Record<string, jest.Mock>;

  beforeEach(async () => {
    qb = {};
    for (const m of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'skip', 'take']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);

    staysRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => qb),
    };
    roomsRepo = { find: jest.fn().mockResolvedValue([]) };
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(HOTEL) };
    auditLogs = { log: jest.fn() };
    stayCodes = {
      issueUniqueCode: jest
        .fn()
        .mockResolvedValue({ code: '123456', codeHash: 'hmac-of-code' }),
    };
    tenantUrls = {
      buildGuestUrl: jest.fn(() => 'https://guest.gxp.example/sunrise'),
    };
    events = { emitAsync: jest.fn() };

    managerHotel = {
      findOne: jest.fn().mockResolvedValue({ ...HOTEL }),
    };
    managerRooms = {
      findOne: jest.fn().mockResolvedValue({ ...ROOM }),
    };
    managerStays = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'stay-new', createdAt: new Date(), ...d })),
      save: jest.fn(async (s) => s),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Hotel) return managerHotel;
        if (entity === Room) return managerRooms;
        return managerStays;
      }),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantStaysService,
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: StayCodeService, useValue: stayCodes },
        { provide: TenantUrlsService, useValue: tenantUrls },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = moduleRef.get(TenantStaysService);
  });

  describe('checkIn (13.1)', () => {
    it('AC1 — rejects a check-out date not after check-in', async () => {
      await expect(
        service.checkIn(
          makeActor(),
          baseDto({ checkOutDate: futureDate(0), checkInDate: futureDate(0) }),
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: { code: 'INVALID_STAY_DATES' },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('AC2 — locks the hotel row BEFORE the room row (race discipline)', async () => {
      const callOrder: string[] = [];
      managerHotel.findOne.mockImplementation(async (opts: any) => {
        if (opts?.lock) callOrder.push('lockHotel');
        return { ...HOTEL };
      });
      managerRooms.findOne.mockImplementation(async (opts: any) => {
        if (opts?.lock) callOrder.push('lockRoom');
        return { ...ROOM };
      });

      await service.checkIn(makeActor(), baseDto());

      expect(callOrder).toEqual(['lockHotel', 'lockRoom']);
      expect(managerHotel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(managerRooms.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'room-1', hotelId: HOTEL_ID },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('404s a room that belongs to another hotel (isolation — never 403)', async () => {
      managerRooms.findOne.mockResolvedValue(null);
      await expect(service.checkIn(makeActor(), baseDto())).rejects.toMatchObject({
        constructor: NotFoundException,
        response: { code: 'ROOM_NOT_FOUND' },
      });
    });

    it('AC1 — 409s a room that is not active (out_of_service / inactive)', async () => {
      managerRooms.findOne.mockResolvedValue({ ...ROOM, status: 'out_of_service' });
      await expect(service.checkIn(makeActor(), baseDto())).rejects.toMatchObject({
        constructor: ConflictException,
        response: { code: 'ROOM_NOT_AVAILABLE' },
      });
    });

    it('AC2 — 409s a room with an active stay', async () => {
      managerStays.findOne.mockResolvedValue({ id: 'stay-existing' });
      await expect(service.checkIn(makeActor(), baseDto())).rejects.toMatchObject({
        constructor: ConflictException,
        response: { code: 'ROOM_OCCUPIED' },
      });
    });

    it('AC2 — maps the partial-unique-index race (23505) to ROOM_OCCUPIED', async () => {
      const driverError = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'UQ_stays_room_active',
      });
      managerStays.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], driverError),
      );
      await expect(service.checkIn(makeActor(), baseDto())).rejects.toMatchObject({
        constructor: ConflictException,
        response: { code: 'ROOM_OCCUPIED' },
      });
    });

    it('AC3/AC5 — stores only the hash, returns the code once, audits without it', async () => {
      const result = await service.checkIn(makeActor(), baseDto());

      expect(result.code).toEqual('123456');
      const saved = managerStays.save.mock.calls[0][0];
      expect(saved.codeHash).toEqual('hmac-of-code');
      expect(JSON.stringify(saved)).not.toContain('123456');

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'stay.checked_in',
          entityType: 'stay',
          actorId: 'actor-1',
          metadata: expect.objectContaining({
            actorType: 'tenant_user',
            hotelId: HOTEL_ID,
            guestName: 'Ahmed Ali',
            roomNumber: '101',
          }),
        }),
      );
      expect(JSON.stringify(auditLogs.log.mock.calls)).not.toContain('123456');
    });

    it('AC4 — emits stay.code_issued only when an email was entered', async () => {
      await service.checkIn(makeActor(), baseDto());
      expect(events.emitAsync).not.toHaveBeenCalled();

      await service.checkIn(
        makeActor(),
        baseDto({ email: 'guest@example.com' }),
      );
      expect(events.emitAsync).toHaveBeenCalledWith(
        'stay.code_issued',
        expect.objectContaining({
          guestEmail: 'guest@example.com',
          rawCode: '123456',
          roomNumber: '101',
          slug: 'sunrise',
          guestAppUrl: 'https://guest.gxp.example/sunrise',
          language: 'ar',
        }),
      );
    });
  });

  describe('list (13.2)', () => {
    it('AC1 — active view filters by search/floor and sorts in room natural order', async () => {
      const rooms = [
        { id: 'r-110', roomNumber: '110', floor: 1, status: 'active' },
        { id: 'r-102', roomNumber: '102', floor: 1, status: 'active' },
        { id: 'r-201', roomNumber: '201', floor: 2, status: 'active' },
      ];
      roomsRepo.find.mockResolvedValue(rooms);
      staysRepo.find.mockResolvedValue([
        { id: 's1', roomId: 'r-110', guestName: 'Mona', status: 'active', checkOutDate: futureDate(2) },
        { id: 's2', roomId: 'r-102', guestName: 'Omar', status: 'active', checkOutDate: futureDate(1) },
        { id: 's3', roomId: 'r-201', guestName: 'Nour', status: 'active', checkOutDate: futureDate(5) },
      ]);

      const all = await service.list(makeActor(), { view: 'active' } as any);
      expect(all.data.map((s: any) => s.roomNumber)).toEqual(['102', '110', '201']);

      const floor1 = await service.list(makeActor(), { view: 'active', floor: 1 } as any);
      expect(floor1.data.map((s: any) => s.guestName)).toEqual(['Omar', 'Mona']);

      const byName = await service.list(makeActor(), { view: 'active', search: 'mona' } as any);
      expect(byName.data.map((s: any) => s.guestName)).toEqual(['Mona']);

      const byRoom = await service.list(makeActor(), { view: 'active', search: '201' } as any);
      expect(byRoom.data.map((s: any) => s.guestName)).toEqual(['Nour']);
    });

    it('AC1 — nights remaining counts from hotel-local today, never negative', async () => {
      roomsRepo.find.mockResolvedValue([{ ...ROOM, id: 'r-1' }]);
      const today = hotelLocalParts('Africa/Cairo', new Date()).date;
      staysRepo.find.mockResolvedValue([
        { id: 's1', roomId: 'r-1', guestName: 'A', status: 'active', checkOutDate: today },
      ]);
      const res = await service.list(makeActor(), { view: 'active' } as any);
      expect(res.data[0].nightsRemaining).toEqual(0);
    });

    it('AC2 — history is paginated join-free, newest checkout first, room search via subquery', async () => {
      qb.getManyAndCount.mockResolvedValue([
        [{ id: 's9', roomId: 'r-110', guestName: 'Past Guest', status: 'checked_out', checkoutType: 'manual' }],
        41,
      ]);
      roomsRepo.find.mockResolvedValue([
        { id: 'r-110', roomNumber: '110', floor: 1 },
      ]);

      const res = await service.list(makeActor(), {
        view: 'history',
        search: '110',
        page: 3,
        pageSize: 20,
      } as any);

      expect(res).toMatchObject({ total: 41, page: 3, pageSize: 20 });
      expect(res.data[0]).toMatchObject({ roomNumber: '110', checkoutType: 'manual' });
      expect(qb.skip).toHaveBeenCalledWith(40);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(qb.orderBy).toHaveBeenCalledWith('s.checkedOutAt', 'DESC', 'NULLS LAST');
      // No join — room search runs as a subquery bound to the same hotel.
      const [subquery] = qb.andWhere.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('SELECT'),
      )!;
      expect(subquery).toContain('"rooms"');
      expect(subquery).toContain('"hotelId"');
    });
  });

  describe('availableRooms (13.1 AC1)', () => {
    it('returns active rooms without an active stay, naturally ordered', async () => {
      roomsRepo.find.mockResolvedValue([
        { id: 'r-110', roomNumber: '110', floor: 1, status: 'active' },
        { id: 'r-102', roomNumber: '102', floor: 1, status: 'active' },
        { id: 'r-2', roomNumber: '2', floor: null, status: 'active' },
      ]);
      staysRepo.find.mockResolvedValue([{ roomId: 'r-110' }]);

      const rooms = await service.availableRooms(makeActor());
      expect(rooms.map((r) => r.roomNumber)).toEqual(['102', '2']);
      expect(roomsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { hotelId: HOTEL_ID, status: 'active' },
        }),
      );
    });
  });

  describe('detail (13.2)', () => {
    it('404s stays of other hotels (isolation)', async () => {
      staysRepo.findOne.mockResolvedValue(null);
      await expect(service.detail(makeActor(), 'stay-x')).rejects.toMatchObject({
        constructor: NotFoundException,
        response: { code: 'STAY_NOT_FOUND' },
      });
      expect(staysRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'stay-x', hotelId: HOTEL_ID } }),
      );
    });
  });

  describe('findActiveByRoomIds (13.2 AC3)', () => {
    it('is a single query mapping roomId → stay, deduped', async () => {
      staysRepo.find.mockResolvedValue([
        { id: 's1', roomId: 'r-1', guestName: 'A', status: 'active' },
      ]);
      const map = await service.findActiveByRoomIds(['r-1', 'r-1', 'r-2']);
      expect(map.get('r-1')!.guestName).toEqual('A');
      expect(map.has('r-2')).toBe(false);
      expect(staysRepo.find).toHaveBeenCalledTimes(1);
    });

    it('skips the query entirely for an empty page', async () => {
      const map = await service.findActiveByRoomIds([]);
      expect(map.size).toEqual(0);
      expect(staysRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('update (13.3 AC1/AC5)', () => {
    const activeStay = (o: Record<string, unknown> = {}) =>
      ({
        id: 'stay-1',
        hotelId: HOTEL_ID,
        roomId: 'room-1',
        guestName: 'Ahmed Ali',
        email: null,
        phone: null,
        language: 'ar',
        guestsCount: null,
        note: null,
        status: 'active',
        checkInDate: futureDate(-2),
        checkOutDate: futureDate(3),
        checkoutType: null,
        checkedOutAt: null,
        createdAt: new Date(),
        room: { ...ROOM },
        ...o,
      }) as unknown as Stay;

    beforeEach(() => {
      staysRepo.save = jest.fn(async (s) => s);
    });

    it('AC1 — extends the stay and audits old/new dates', async () => {
      staysRepo.findOne.mockResolvedValue(activeStay());
      const res = await service.update(makeActor(), 'stay-1', {
        checkOutDate: futureDate(6),
      } as any);

      expect(res.checkOutDate).toEqual(futureDate(6));
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'stay.dates_changed',
          metadata: expect.objectContaining({
            checkOutDate: { from: futureDate(3), to: futureDate(6) },
          }),
        }),
      );
    });

    it('AC1 — rejects a check-out date in the past (hotel-local today rule)', async () => {
      staysRepo.findOne.mockResolvedValue(activeStay());
      await expect(
        service.update(makeActor(), 'stay-1', {
          checkOutDate: futureDate(-1),
        } as any),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STAY_DATES' } });
      expect(staysRepo.save).not.toHaveBeenCalled();
    });

    it('AC1 — rejects a check-out date not after check-in', async () => {
      staysRepo.findOne.mockResolvedValue(activeStay({ checkInDate: futureDate(4), checkOutDate: futureDate(5) }));
      await expect(
        service.update(makeActor(), 'stay-1', { checkOutDate: futureDate(4) } as any),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STAY_DATES' } });
    });

    it('AC5 — audits a guest-info diff, clearing nullable fields with null', async () => {
      staysRepo.findOne.mockResolvedValue(
        activeStay({ email: 'old@example.com', note: 'old note' }),
      );
      await service.update(makeActor(), 'stay-1', {
        guestName: 'Ahmed A. Ali',
        email: null,
        guestsCount: 3,
      } as any);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'stay.updated',
          metadata: expect.objectContaining({
            diff: {
              guestName: { from: 'Ahmed Ali', to: 'Ahmed A. Ali' },
              email: { from: 'old@example.com', to: null },
              guestsCount: { from: null, to: 3 },
            },
          }),
        }),
      );
    });

    it('is a no-op without changes — no save, no audit', async () => {
      staysRepo.findOne.mockResolvedValue(activeStay());
      await service.update(makeActor(), 'stay-1', {
        guestName: 'Ahmed Ali',
      } as any);
      expect(staysRepo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('13.4 AC4 — a checked-out stay can no longer be edited', async () => {
      staysRepo.findOne.mockResolvedValue(activeStay({ status: 'checked_out' }));
      await expect(
        service.update(makeActor(), 'stay-1', { guestName: 'X' } as any),
      ).rejects.toMatchObject({ response: { code: 'STAY_NOT_ACTIVE' } });
    });
  });

  describe('changeRoom (13.3 AC2)', () => {
    const stayRow = () =>
      ({
        id: 'stay-1',
        hotelId: HOTEL_ID,
        roomId: 'room-1',
        guestName: 'Ahmed Ali',
        status: 'active',
        checkInDate: futureDate(-1),
        checkOutDate: futureDate(2),
      }) as unknown as Stay;

    it('moves to an available room with the hotel lock first, audits from/to', async () => {
      const callOrder: string[] = [];
      managerHotel.findOne.mockImplementation(async (opts: any) => {
        if (opts?.lock) callOrder.push('lockHotel');
        return { ...HOTEL };
      });
      managerStays.findOne
        .mockResolvedValueOnce(stayRow()) // the stay itself
        .mockResolvedValueOnce(null); // target-room occupancy check
      managerRooms.findOne
        .mockResolvedValueOnce({ ...ROOM }) // current room (audit "from")
        .mockImplementationOnce(async (opts: any) => {
          if (opts?.lock) callOrder.push('lockRoom');
          return { id: 'room-2', hotelId: HOTEL_ID, roomNumber: '202', floor: 2, status: 'active' };
        });
      managerStays.save = jest.fn(async (s) => s);

      const res = await service.changeRoom(makeActor(), 'stay-1', {
        roomId: 'room-2',
      } as any);

      expect(callOrder[0]).toEqual('lockHotel');
      expect(res.roomNumber).toEqual('202');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'stay.room_changed',
          metadata: expect.objectContaining({ from: '101', to: '202' }),
        }),
      );
    });

    it('409s when the target room is occupied', async () => {
      managerStays.findOne
        .mockResolvedValueOnce(stayRow())
        .mockResolvedValueOnce({ id: 'other-stay' });
      managerRooms.findOne
        .mockResolvedValueOnce({ ...ROOM })
        .mockResolvedValueOnce({ id: 'room-2', hotelId: HOTEL_ID, roomNumber: '202', status: 'active' });

      await expect(
        service.changeRoom(makeActor(), 'stay-1', { roomId: 'room-2' } as any),
      ).rejects.toMatchObject({ response: { code: 'ROOM_OCCUPIED' } });
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('maps the unique-index race to ROOM_OCCUPIED (same as check-in)', async () => {
      managerStays.findOne
        .mockResolvedValueOnce(stayRow())
        .mockResolvedValueOnce(null);
      managerRooms.findOne
        .mockResolvedValueOnce({ ...ROOM })
        .mockResolvedValueOnce({ id: 'room-2', hotelId: HOTEL_ID, roomNumber: '202', status: 'active' });
      const driverError = Object.assign(new Error('dup'), {
        code: '23505',
        constraint: 'UQ_stays_room_active',
      });
      managerStays.save = jest
        .fn()
        .mockRejectedValue(new QueryFailedError('UPDATE', [], driverError));

      await expect(
        service.changeRoom(makeActor(), 'stay-1', { roomId: 'room-2' } as any),
      ).rejects.toMatchObject({ response: { code: 'ROOM_OCCUPIED' } });
    });

    it('moving to the same room is a no-op (no audit)', async () => {
      managerStays.findOne.mockResolvedValueOnce(stayRow());
      managerRooms.findOne.mockResolvedValueOnce({ ...ROOM });
      const res = await service.changeRoom(makeActor(), 'stay-1', {
        roomId: 'room-1',
      } as any);
      expect(res.roomNumber).toEqual('101');
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

  describe('regenerateCode (13.3 AC4)', () => {
    it('replaces the hash, returns the new code once, audits without it', async () => {
      stayCodes.issueUniqueCode.mockResolvedValue({
        code: '654321',
        codeHash: 'hmac-new',
      });
      managerStays.findOne.mockResolvedValue({
        id: 'stay-1',
        hotelId: HOTEL_ID,
        roomId: 'room-1',
        guestName: 'Ahmed Ali',
        status: 'active',
        codeHash: 'hmac-old',
        checkInDate: futureDate(-1),
        checkOutDate: futureDate(2),
        room: { ...ROOM },
      });
      managerStays.save = jest.fn(async (s) => s);

      const res = await service.regenerateCode(makeActor(), 'stay-1');

      expect(res.code).toEqual('654321');
      expect(managerStays.save.mock.calls[0][0].codeHash).toEqual('hmac-new');
      // Sessions ride the stay — status/id untouched by regeneration.
      expect(managerStays.save.mock.calls[0][0]).toMatchObject({
        id: 'stay-1',
        status: 'active',
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'stay.code_regenerated' }),
      );
      expect(JSON.stringify(auditLogs.log.mock.calls)).not.toContain('654321');
    });

    it('refuses on a checked-out stay', async () => {
      managerStays.findOne.mockResolvedValue({
        id: 'stay-1',
        hotelId: HOTEL_ID,
        status: 'checked_out',
      });
      await expect(
        service.regenerateCode(makeActor(), 'stay-1'),
      ).rejects.toMatchObject({ response: { code: 'STAY_NOT_ACTIVE' } });
    });
  });

  describe('checkout (13.4 AC1/AC4)', () => {
    it('AC1 — flips to checked_out/manual with actor + timestamp and audits', async () => {
      staysRepo.findOne.mockResolvedValue({
        id: 'stay-1',
        hotelId: HOTEL_ID,
        roomId: 'room-1',
        guestName: 'Ahmed Ali',
        status: 'active',
        checkInDate: futureDate(-1),
        checkOutDate: futureDate(2),
        room: { ...ROOM },
      });
      staysRepo.save = jest.fn(async (s) => s);

      const res = await service.checkout(makeActor(), 'stay-1');

      expect(res).toMatchObject({ status: 'checked_out', checkoutType: 'manual' });
      const saved = staysRepo.save.mock.calls[0][0];
      expect(saved.checkedOutById).toEqual('actor-1');
      expect(saved.checkedOutAt).toBeInstanceOf(Date);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'stay.checked_out',
          metadata: expect.objectContaining({ checkoutType: 'manual' }),
        }),
      );
    });

    it('AC4 — no resurrection: checking out twice 409s', async () => {
      staysRepo.findOne.mockResolvedValue({
        id: 'stay-1',
        hotelId: HOTEL_ID,
        status: 'checked_out',
        room: { ...ROOM },
      });
      await expect(service.checkout(makeActor(), 'stay-1')).rejects.toMatchObject(
        { response: { code: 'STAY_NOT_ACTIVE' } },
      );
    });
  });

  describe('stay settings (13.4 AC2)', () => {
    it('reads the hotel checkout time', async () => {
      await expect(service.getSettings(HOTEL_ID)).resolves.toEqual({
        checkoutTime: '12:00',
      });
    });

    it('updates it with an audited diff', async () => {
      hotelsRepo.findOne.mockResolvedValue({ ...HOTEL });
      hotelsRepo.save = jest.fn(async (h) => h);
      const res = await service.updateSettings(makeActor(), {
        checkoutTime: '14:00',
      } as any);
      expect(res).toEqual({ checkoutTime: '14:00' });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel.updated',
          metadata: expect.objectContaining({
            diff: { checkoutTime: { from: '12:00', to: '14:00' } },
          }),
        }),
      );
    });

    it('is a no-op when unchanged', async () => {
      hotelsRepo.findOne.mockResolvedValue({ ...HOTEL });
      hotelsRepo.save = jest.fn();
      await service.updateSettings(makeActor(), { checkoutTime: '12:00' } as any);
      expect(hotelsRepo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

  describe('naturalRoomCompare', () => {
    it('orders numerically inside a floor, letters after numbers', () => {
      const sorted = [
        { floor: 1, roomNumber: '110' },
        { floor: 1, roomNumber: '101A' },
        { floor: null, roomNumber: 'ANNEX' },
        { floor: 1, roomNumber: '102' },
      ].sort(naturalRoomCompare);
      expect(sorted.map((r) => r.roomNumber)).toEqual(['101A', '102', '110', 'ANNEX']);
    });
  });
});
