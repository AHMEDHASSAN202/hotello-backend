import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { Room } from '../tenant-rooms/room.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { HousekeepingService } from './housekeeping.service';

const HOTEL_ID = 'hotel-1';
const OTHER_HOTEL_ID = 'hotel-2';

const HOTEL = {
  id: HOTEL_ID,
  timezone: 'Africa/Cairo',
  dailyServiceTime: '09:00',
} as unknown as Hotel;

const makeActor = (o: Record<string, unknown> = {}): TenantUser =>
  ({ id: 'actor-1', hotelId: HOTEL_ID, name: 'Sara', ...o }) as unknown as TenantUser;

const makeRoom = (o: Record<string, unknown> = {}): Room =>
  ({
    id: 'room-1',
    hotelId: HOTEL_ID,
    roomNumber: '101',
    floor: 1,
    status: 'active',
    housekeepingStatus: 'clean',
    cleaningType: null,
    dndSetByStayId: null,
    housekeepingAssignedToId: null,
    lastCleanedAt: null,
    lastCleanedById: null,
    lastDailyFlaggedOn: null,
    updatedAt: new Date('2026-08-29T08:00:00Z'),
    ...o,
  }) as unknown as Room;

const makeStay = (o: Record<string, unknown> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: HOTEL_ID,
    roomId: 'room-1',
    status: 'active',
    ...o,
  }) as unknown as Stay;

const accessState = (o: Record<string, unknown> = {}) => ({
  hotelStatus: 'active',
  readOnly: false,
  enabledModules: ['housekeeping'],
  ...o,
});

describe('HousekeepingService', () => {
  let service: HousekeepingService;
  let roomsRepo: Record<string, jest.Mock>;
  let staysRepo: Record<string, jest.Mock>;
  let hotelsRepo: Record<string, jest.Mock>;
  let usersRepo: Record<string, jest.Mock>;
  let access: { getAccessState: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let qb: Record<string, jest.Mock>;

  beforeEach(async () => {
    qb = {};
    for (const m of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'innerJoinAndSelect']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.getMany = jest.fn().mockResolvedValue([]);

    roomsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (r) => r),
      createQueryBuilder: jest.fn(() => qb),
    };
    staysRepo = { find: jest.fn().mockResolvedValue([]) };
    hotelsRepo = {
      findOne: jest.fn().mockResolvedValue({ ...HOTEL }),
      save: jest.fn(async (h) => h),
    };
    usersRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => qb),
    };
    access = { getAccessState: jest.fn().mockResolvedValue(accessState()) };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HousekeepingService,
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(TenantUser), useValue: usersRepo },
        { provide: TenantAccessService, useValue: access },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(HousekeepingService);
  });

  describe('listBoard (20.2)', () => {
    it('full load: board rooms in natural order with occupancy + counts + serverTime', async () => {
      qb.getMany.mockResolvedValue([
        makeRoom({ id: 'room-1', housekeepingStatus: 'needs_cleaning', cleaningType: 'checkout' }),
        makeRoom({ id: 'room-2', roomNumber: '102' }),
      ]);
      staysRepo.find.mockResolvedValue([{ id: 'stay-1', roomId: 'room-1' }]);

      const res = await service.listBoard(makeActor(), {});

      expect(roomsRepo.createQueryBuilder).toHaveBeenCalledWith('r');
      expect(qb.where).toHaveBeenCalledWith('r.hotelId = :hotelId', {
        hotelId: HOTEL_ID,
      });
      expect(res.data).toHaveLength(2);
      expect(res.data[0]).toMatchObject({
        id: 'room-1',
        housekeepingStatus: 'needs_cleaning',
        cleaningType: 'checkout',
        occupied: true,
      });
      expect(res.data[1]).toMatchObject({ id: 'room-2', occupied: false });
      expect(res.counts).toBeDefined();
      expect(typeof res.serverTime).toEqual('string');
    });

    it('delta: changed rows return views; rooms gone inactive become tombstones', async () => {
      roomsRepo.find.mockResolvedValue([
        makeRoom({ id: 'room-1' }),
        makeRoom({ id: 'room-9', status: 'inactive' }),
      ]);

      const res = await service.listBoard(makeActor(), {
        updatedSince: '2026-08-29T07:00:00.000Z',
      });

      // naiveUtc: the cursor param must be an ISO string, never a raw Date
      // (the Epic 16 host-timezone delta bug).
      const where = roomsRepo.find.mock.calls[0][0].where;
      expect(typeof where.updatedAt.value).toEqual('string');
      expect(res.data).toContainEqual({ id: 'room-9', active: false });
      expect(res.data.find((d) => d.id === 'room-1')).toMatchObject({
        housekeepingStatus: 'clean',
      });
    });
  });

  describe('counts (20.2 AC2)', () => {
    it('splits to-clean by type and scopes every counter to board rooms', async () => {
      roomsRepo.count
        .mockResolvedValueOnce(2) // checkout
        .mockResolvedValueOnce(3) // daily
        .mockResolvedValueOnce(1) // in progress
        .mockResolvedValueOnce(4) // done today
        .mockResolvedValueOnce(1); // dnd
      const counts = await service.counts(HOTEL_ID);
      expect(counts).toEqual({
        toCleanCheckout: 2,
        toCleanDaily: 3,
        inProgress: 1,
        doneToday: 4,
        dnd: 1,
      });
      expect(roomsRepo.count).toHaveBeenCalledTimes(5);
    });
  });

  describe('lifecycle actions (20.3 AC2)', () => {
    it('start flags in_progress and auto-assigns the actor when unowned', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({ housekeepingStatus: 'needs_cleaning', cleaningType: 'daily' }),
      );
      const view = await service.start(makeActor(), 'room-1');
      expect(view).toMatchObject({
        housekeepingStatus: 'in_progress',
        cleaningType: 'daily',
      });
      expect(roomsRepo.save.mock.calls[0][0].housekeepingAssignedToId).toEqual('actor-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.started',
          metadata: expect.objectContaining({ autoAssigned: true }),
        }),
      );
    });

    it('start keeps an existing assignee', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({
          housekeepingStatus: 'needs_cleaning',
          cleaningType: 'daily',
          housekeepingAssignedToId: 'user-2',
        }),
      );
      await service.start(makeActor(), 'room-1');
      expect(roomsRepo.save.mock.calls[0][0].housekeepingAssignedToId).toEqual('user-2');
    });

    it('start on a DND room 409s with its own code (20.4 AC2)', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom({ housekeepingStatus: 'dnd' }));
      await expect(service.start(makeActor(), 'room-1')).rejects.toMatchObject({
        response: { code: 'HOUSEKEEPING_ROOM_DND' },
      });
      expect(roomsRepo.save).not.toHaveBeenCalled();
    });

    it('complete stamps the room memory and releases the assignment (20.3 AC3)', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({
          housekeepingStatus: 'in_progress',
          cleaningType: 'checkout',
          housekeepingAssignedToId: 'actor-1',
        }),
      );
      const view = await service.complete(makeActor(), 'room-1');
      expect(view).toMatchObject({ housekeepingStatus: 'clean', cleaningType: null });
      const saved = roomsRepo.save.mock.calls[0][0];
      expect(saved.lastCleanedAt).toBeInstanceOf(Date);
      expect(saved.lastCleanedById).toEqual('actor-1');
      expect(saved.housekeepingAssignedToId).toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.completed',
          metadata: expect.objectContaining({ cleaningType: 'checkout' }),
        }),
      );
    });

    it('interrupt returns to needs_cleaning, keeps type + assignee, audits the reason', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({
          housekeepingStatus: 'in_progress',
          cleaningType: 'daily',
          housekeepingAssignedToId: 'actor-1',
        }),
      );
      const view = await service.interrupt(makeActor(), 'room-1', {
        reason: 'Guest returned',
      });
      expect(view).toMatchObject({
        housekeepingStatus: 'needs_cleaning',
        cleaningType: 'daily',
      });
      expect(roomsRepo.save.mock.calls[0][0].housekeepingAssignedToId).toEqual('actor-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.interrupted',
          metadata: expect.objectContaining({ reason: 'Guest returned' }),
        }),
      );
    });

    it('invalid transitions 409 with the current state', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
      await expect(
        service.complete(makeActor(), 'room-1'),
      ).rejects.toMatchObject({
        response: { code: 'HOUSEKEEPING_INVALID_STATUS', status: 'clean' },
      });
    });

    it('cross-tenant and inactive rooms 404 identically (isolation)', async () => {
      roomsRepo.findOne.mockResolvedValue(null);
      await expect(service.start(makeActor(), 'foreign-room')).rejects.toMatchObject({
        response: { code: 'ROOM_NOT_FOUND' },
      });
      expect(roomsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'foreign-room', hotelId: HOTEL_ID },
      });

      roomsRepo.findOne.mockResolvedValue(makeRoom({ status: 'inactive' }));
      await expect(service.start(makeActor(), 'room-1')).rejects.toMatchObject({
        response: { code: 'ROOM_NOT_FOUND' },
      });
    });
  });

  describe('manual flag / clear (20.1 AC5)', () => {
    it('flags with a type and audits the reason', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
      const view = await service.flagRoom(makeActor(), 'room-1', {
        cleaningType: 'checkout',
        reason: 'Spill in 101',
      });
      expect(view).toMatchObject({
        housekeepingStatus: 'needs_cleaning',
        cleaningType: 'checkout',
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.flagged',
          metadata: expect.objectContaining({
            cleaningType: 'checkout',
            reason: 'Spill in 101',
          }),
        }),
      );
    });

    it('clear unflags and audits', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({ housekeepingStatus: 'needs_cleaning', cleaningType: 'daily' }),
      );
      const view = await service.clearRoom(makeActor(), 'room-1', {});
      expect(view).toMatchObject({ housekeepingStatus: 'clean', cleaningType: null });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'housekeeping.cleared' }),
      );
    });
  });

  describe('assignment (20.3 AC1)', () => {
    const validAssignee = {
      id: 'user-2',
      hotelId: HOTEL_ID,
      status: 'active',
      name: 'Mona',
      role: { permissions: ['housekeeping.update'] },
    };

    it('assigns a staff member holding housekeeping.update', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
      usersRepo.findOne.mockResolvedValue(validAssignee);
      const view = await service.assign(makeActor(), 'room-1', {
        assigneeId: 'user-2',
      });
      expect(roomsRepo.save.mock.calls[0][0].housekeepingAssignedToId).toEqual('user-2');
      expect(view).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.assigned',
          metadata: expect.objectContaining({ assigneeId: 'user-2' }),
        }),
      );
    });

    it('null unassigns', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({ housekeepingAssignedToId: 'user-2' }),
      );
      await service.assign(makeActor(), 'room-1', { assigneeId: null });
      expect(roomsRepo.save.mock.calls[0][0].housekeepingAssignedToId).toBeNull();
    });

    it('422s an assignee without the permission (server-side revalidation)', async () => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
      usersRepo.findOne.mockResolvedValue({
        ...validAssignee,
        role: { permissions: ['requests.update'] },
      });
      await expect(
        service.assign(makeActor(), 'room-1', { assigneeId: 'user-2' }),
      ).rejects.toMatchObject({
        response: { code: 'HOUSEKEEPING_ASSIGNEE_INVALID' },
      });
    });

    it('bulk-assign drops foreign room ids and emits ONE audit event', async () => {
      usersRepo.findOne.mockResolvedValue(validAssignee);
      roomsRepo.find.mockResolvedValue([
        makeRoom({ id: 'room-1' }),
        makeRoom({ id: 'room-2', roomNumber: '102' }),
      ]);

      const views = await service.bulkAssign(makeActor(), {
        roomIds: ['room-1', 'room-2', 'foreign-room'],
        assigneeId: 'user-2',
      });

      // The hotelId filter IS the isolation boundary — foreign ids vanish.
      expect(roomsRepo.find.mock.calls[0][0].where.hotelId).toEqual(HOTEL_ID);
      expect(views).toHaveLength(2);
      expect(auditLogs.log).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.assigned',
          metadata: expect.objectContaining({
            bulk: true,
            count: 2,
            roomIds: ['room-1', 'room-2'],
          }),
        }),
      );
    });
  });

  describe('assignee options (20.3 AC1)', () => {
    it('queries active staff holding housekeeping.update or the wildcard', async () => {
      qb.getMany.mockResolvedValue([
        { id: 'u1', name: 'Mona', role: { nameEn: 'Housekeeping', nameAr: 'التدبير' } },
      ]);
      const res = await service.listAssignees(makeActor());
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('r.permissions @> ARRAY[:perm]::text[]'),
        expect.objectContaining({ perm: 'housekeeping.update' }),
      );
      expect(res).toEqual([
        { id: 'u1', name: 'Mona', roleNameEn: 'Housekeeping', roleNameAr: 'التدبير' },
      ]);
    });
  });

  describe('settings (20.1 AC4)', () => {
    it('reads the daily service hour', async () => {
      await expect(service.getSettings(HOTEL_ID)).resolves.toEqual({
        dailyServiceTime: '09:00',
      });
    });

    it('updates with an audited diff', async () => {
      const res = await service.updateSettings(makeActor(), {
        dailyServiceTime: '10:30',
      });
      expect(res).toEqual({ dailyServiceTime: '10:30' });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel.updated',
          metadata: expect.objectContaining({
            diff: { dailyServiceTime: { from: '09:00', to: '10:30' } },
          }),
        }),
      );
    });

    it('no-op update writes nothing', async () => {
      await service.updateSettings(makeActor(), { dailyServiceTime: '09:00' });
      expect(hotelsRepo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

  describe('onRoomVacated (20.1 AC3, note 3)', () => {
    it('flags needs_cleaning (checkout) and clears DND from any state', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({
          housekeepingStatus: 'dnd',
          cleaningType: 'daily',
          dndSetByStayId: 'stay-1',
        }),
      );
      await service.onRoomVacated('room-1', HOTEL_ID, 'actor-1');
      const saved = roomsRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        housekeepingStatus: 'needs_cleaning',
        cleaningType: 'checkout',
        dndSetByStayId: null,
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.flagged',
          metadata: expect.objectContaining({
            cleaningType: 'checkout',
            reason: 'room_vacated',
            from: 'dnd',
          }),
        }),
      );
    });

    it('never throws into the checkout path', async () => {
      roomsRepo.findOne.mockRejectedValue(new Error('db down'));
      await expect(
        service.onRoomVacated('room-1', HOTEL_ID, null),
      ).resolves.toBeUndefined();
    });
  });

  describe('setDnd (20.4)', () => {
    beforeEach(() => {
      roomsRepo.findOne.mockResolvedValue(makeRoom());
    });

    it('switches DND on: parks state, binds the stay, stamps today (hotel-local)', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({ housekeepingStatus: 'needs_cleaning', cleaningType: 'daily' }),
      );
      const res = await service.setDnd(makeStay(), true);
      expect(res).toEqual({ dndActive: true });
      const saved = roomsRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        housekeepingStatus: 'dnd',
        cleaningType: 'daily', // parked, not lost (20.4 AC2)
        dndSetByStayId: 'stay-1',
      });
      // "Away TODAY": the stamp opts the room out of today's daily tick.
      expect(saved.lastDailyFlaggedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.dnd_set',
          actorId: null,
          metadata: expect.objectContaining({ actorType: 'guest', stayId: 'stay-1' }),
        }),
      );
    });

    it('switches DND off: restores the parked flag', async () => {
      roomsRepo.findOne.mockResolvedValue(
        makeRoom({
          housekeepingStatus: 'dnd',
          cleaningType: 'checkout',
          dndSetByStayId: 'stay-1',
        }),
      );
      const res = await service.setDnd(makeStay(), false);
      expect(res).toEqual({ dndActive: false });
      expect(roomsRepo.save.mock.calls[0][0]).toMatchObject({
        housekeepingStatus: 'needs_cleaning',
        cleaningType: 'checkout',
        dndSetByStayId: null,
      });
    });

    it('is idempotent — repeating the current state audits nothing', async () => {
      await service.setDnd(makeStay(), false); // already off
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('module off → MODULE_NOT_ENABLED (guard no-ops on guest routes)', async () => {
      access.getAccessState.mockResolvedValue(
        accessState({ enabledModules: ['requests'] }),
      );
      await expect(service.setDnd(makeStay(), true)).rejects.toMatchObject({
        response: { code: 'MODULE_NOT_ENABLED' },
      });
    });

    it('read-only subscription → HOTEL_UNAVAILABLE (guest posture)', async () => {
      access.getAccessState.mockResolvedValue(accessState({ readOnly: true }));
      await expect(service.setDnd(makeStay(), true)).rejects.toMatchObject({
        response: { code: 'HOTEL_UNAVAILABLE' },
      });
    });

    it('never trusts a client room — the stay binds the lookup', async () => {
      await service.setDnd(makeStay({ roomId: 'room-7', hotelId: OTHER_HOTEL_ID }), true);
      expect(roomsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'room-7', hotelId: OTHER_HOTEL_ID },
      });
    });
  });
});
