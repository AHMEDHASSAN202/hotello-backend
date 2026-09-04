import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { PushService } from '../push/push.service';
import { Room } from '../tenant-rooms/room.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { GuestRequest } from './request.entity';
import { TenantRequestsService } from './tenant-requests.service';

const ACTOR = { id: 'user-1', hotelId: 'hotel-1', name: 'Front Desk Fatma' } as TenantUser;

function makeRequest(overrides: Partial<GuestRequest> = {}): GuestRequest {
  return {
    id: 'req-1',
    hotelId: 'hotel-1',
    stayId: 'stay-1',
    roomId: 'room-1',
    roomNumber: '204',
    itemId: 'item-1',
    categoryId: 'cat-1',
    itemNames: { ar: 'مناشف إضافية', en: 'Extra towels' },
    itemIcon: 'layers',
    optionType: null,
    optionValue: null,
    note: null,
    noteLanguage: null,
    status: 'new',
    slaTargetMinutes: 20,
    dueAt: new Date(),
    assignedToId: null,
    startedAt: null,
    startedById: null,
    completedAt: null,
    completedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelledReason: null,
    cancelNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as GuestRequest;
}

describe('TenantRequestsService', () => {
  let service: TenantRequestsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
  };
  let staysRepo: { find: jest.Mock };
  let roomsRepo: { find: jest.Mock };
  let usersRepo: { find: jest.Mock; findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let push: { notify: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (row) => row),
    };
    staysRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'stay-1', guestName: 'Ivan Petrov', language: 'ru' },
      ]),
    };
    roomsRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'room-1', floor: 2 }]),
    };
    usersRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    hotelsRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'hotel-1', timezone: 'Africa/Cairo' }),
    };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    push = { notify: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRequestsService,
        { provide: getRepositoryToken(GuestRequest), useValue: repo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: getRepositoryToken(TenantUser), useValue: usersRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: PushService, useValue: push },
      ],
    }).compile();
    service = moduleRef.get(TenantRequestsService);
  });

  describe('listBoard (15.4 AC1, note 4)', () => {
    it('returns open requests with batch-loaded guest name and floor', async () => {
      repo.find.mockResolvedValue([makeRequest()]);
      const result = await service.listBoard(ACTOR, { tab: 'open' });
      expect(repo.find.mock.calls[0][0].where.hotelId).toBe('hotel-1');
      expect(result.data[0]).toMatchObject({
        itemNameEn: 'Extra towels',
        itemNameAr: 'مناشف إضافية',
        guestName: 'Ivan Petrov',
        floor: 2,
        roomNumber: '204',
      });
      expect(result.counts).toEqual({ open: 0, doneToday: 0, overdueNow: 0 });
      expect(typeof result.serverTime).toBe('string');
    });

    it('delta mode drops the status filter so completed rows flow to the client', async () => {
      await service.listBoard(ACTOR, {
        updatedSince: '2026-08-22T10:00:00.000Z',
      });
      const where = repo.find.mock.calls[0][0].where;
      expect(where.status).toBeUndefined();
      expect(where.updatedAt).toBeDefined();
    });
  });

  describe('transition matrix (15.5 AC1)', () => {
    it('start: new → in_progress and auto-assigns the actor when unassigned', async () => {
      repo.findOne.mockResolvedValue(makeRequest());
      const result = await service.start(ACTOR, 'req-1');
      expect(repo.save.mock.calls[0][0]).toMatchObject({
        status: 'in_progress',
        startedById: 'user-1',
        assignedToId: 'user-1',
      });
      expect(result.status).toBe('in_progress');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'request.started', actorId: 'user-1' }),
      );
    });

    it('start keeps an existing assignee', async () => {
      repo.findOne.mockResolvedValue(makeRequest({ assignedToId: 'user-9' }));
      await service.start(ACTOR, 'req-1');
      expect(repo.save.mock.calls[0][0].assignedToId).toBe('user-9');
    });

    it('complete: in_progress → done with actor + timestamp', async () => {
      repo.findOne.mockResolvedValue(makeRequest({ status: 'in_progress' }));
      await service.complete(ACTOR, 'req-1');
      expect(repo.save.mock.calls[0][0]).toMatchObject({
        status: 'done',
        completedById: 'user-1',
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'request.completed' }),
      );
    });

    it.each([
      ['start', 'in_progress'],
      ['start', 'done'],
      ['start', 'cancelled'],
      ['complete', 'new'],
      ['complete', 'done'],
      ['complete', 'cancelled'],
      ['cancel', 'done'],
      ['cancel', 'cancelled'],
    ])('%s from %s → 409 REQUEST_INVALID_STATUS', async (action, status) => {
      repo.findOne.mockResolvedValue(makeRequest({ status: status as never }));
      const call =
        action === 'start'
          ? service.start(ACTOR, 'req-1')
          : action === 'complete'
            ? service.complete(ACTOR, 'req-1')
            : service.cancel(ACTOR, 'req-1', { reason: 'duplicate' });
      await expect(call).rejects.toMatchObject({
        response: { code: 'REQUEST_INVALID_STATUS', status },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('staff cancel stores reason + trimmed note', async () => {
      repo.findOne.mockResolvedValue(makeRequest({ status: 'in_progress' }));
      await service.cancel(ACTOR, 'req-1', {
        reason: 'other',
        note: ' broken lamp already fixed ',
      });
      expect(repo.save.mock.calls[0][0]).toMatchObject({
        status: 'cancelled',
        cancelledById: 'user-1',
        cancelledReason: 'other',
        cancelNote: 'broken lamp already fixed',
      });
    });

    it('cross-tenant id → 404 (never confirms other tenants)', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.start(ACTOR, 'req-x')).rejects.toMatchObject({
        response: { code: 'REQUEST_NOT_FOUND' },
      });
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'req-x', hotelId: 'hotel-1' },
      });
    });
  });

  describe('assignment (15.5 AC2)', () => {
    it('assigns an active staff member whose role grants requests.update', async () => {
      repo.findOne.mockResolvedValue(makeRequest());
      usersRepo.findOne.mockResolvedValue({
        id: 'user-2',
        hotelId: 'hotel-1',
        status: 'active',
        name: 'Hany',
        role: { permissions: ['requests.read', 'requests.update'] },
      });
      await service.assign(ACTOR, 'req-1', { assigneeId: 'user-2' });
      expect(repo.save.mock.calls[0][0].assignedToId).toBe('user-2');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'request.assigned' }),
      );
    });

    it('wildcard (Owner) role qualifies as assignee', async () => {
      repo.findOne.mockResolvedValue(makeRequest());
      usersRepo.findOne.mockResolvedValue({
        id: 'owner-1',
        hotelId: 'hotel-1',
        status: 'active',
        name: 'Owner',
        role: { permissions: ['*'] },
      });
      await service.assign(ACTOR, 'req-1', { assigneeId: 'owner-1' });
      expect(repo.save.mock.calls[0][0].assignedToId).toBe('owner-1');
    });

    it.each([
      [
        'role lacks requests.update',
        { id: 'u', hotelId: 'hotel-1', status: 'active', role: { permissions: ['rooms.read'] } },
      ],
      [
        'assignee is disabled',
        { id: 'u', hotelId: 'hotel-1', status: 'disabled', role: { permissions: ['requests.update'] } },
      ],
      ['assignee is from another hotel (lookup scoped)', null],
    ])('422 REQUEST_ASSIGNEE_INVALID when %s', async (_label, assignee) => {
      repo.findOne.mockResolvedValue(makeRequest());
      usersRepo.findOne.mockResolvedValue(assignee);
      await expect(
        service.assign(ACTOR, 'req-1', { assigneeId: 'u' }),
      ).rejects.toMatchObject({
        response: { code: 'REQUEST_ASSIGNEE_INVALID' },
      });
    });

    it('null assignee unassigns', async () => {
      repo.findOne.mockResolvedValue(makeRequest({ assignedToId: 'user-2' }));
      await service.assign(ACTOR, 'req-1', { assigneeId: null });
      expect(repo.save.mock.calls[0][0].assignedToId).toBeNull();
    });
  });

  describe('push hooks (23.4 AC1)', () => {
    it('start() pushes request_status with the request name map and new status', async () => {
      repo.findOne.mockResolvedValue(makeRequest());
      await service.start(ACTOR, 'req-1');
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'request_status',
        expect.objectContaining({
          refId: 'req-1',
          vars: expect.objectContaining({
            id: 'req-1',
            names: { ar: 'مناشف إضافية', en: 'Extra towels' },
            status: 'in_progress',
          }),
        }),
      );
    });

    it('complete() pushes request_status with status done', async () => {
      repo.findOne.mockResolvedValue(makeRequest({ status: 'in_progress' }));
      await service.complete(ACTOR, 'req-1');
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'request_status',
        expect.objectContaining({
          vars: expect.objectContaining({ status: 'done' }),
        }),
      );
    });

    it('staff cancel() pushes request_status with status cancelled', async () => {
      repo.findOne.mockResolvedValue(makeRequest({ status: 'new' }));
      await service.cancel(ACTOR, 'req-1', { reason: 'duplicate' });
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'request_status',
        expect.objectContaining({
          vars: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
    });

    it('assign() does NOT push — not a guest-visible status change', async () => {
      repo.findOne.mockResolvedValue(makeRequest());
      usersRepo.findOne.mockResolvedValue({
        id: 'user-2',
        hotelId: 'hotel-1',
        status: 'active',
        name: 'Hany',
        role: { permissions: ['requests.update'] },
      });
      await service.assign(ACTOR, 'req-1', { assigneeId: 'user-2' });
      expect(push.notify).not.toHaveBeenCalled();
    });

    it('push failure never fails the transition', async () => {
      repo.findOne.mockResolvedValue(makeRequest());
      push.notify.mockRejectedValueOnce(new Error('dispatch exploded'));
      const result = await service.start(ACTOR, 'req-1');
      expect(result.status).toBe('in_progress');
    });
  });

  describe('snapshot immutability (15.1 AC5 / note 6)', () => {
    it('lifecycle transitions never rewrite the item snapshot', async () => {
      const request = makeRequest({ status: 'in_progress' });
      repo.findOne.mockResolvedValue(request);
      await service.complete(ACTOR, 'req-1');
      const saved = repo.save.mock.calls[0][0];
      expect(saved.itemNames).toEqual({ ar: 'مناشف إضافية', en: 'Extra towels' });
      expect(saved.slaTargetMinutes).toBe(20);
      expect(saved.roomNumber).toBe('204');
    });
  });

  describe('counts (15.6 AC3)', () => {
    it('computes open / doneToday (hotel tz) / overdueNow', async () => {
      repo.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2);
      const counts = await service.counts('hotel-1');
      expect(counts).toEqual({ open: 4, doneToday: 7, overdueNow: 2 });
      // doneToday filters on completedAt after hotel-local midnight
      expect(repo.count.mock.calls[1][0].where.status).toBe('done');
      expect(repo.count.mock.calls[1][0].where.completedAt).toBeDefined();
      // overdue = open statuses with dueAt in the past
      expect(repo.count.mock.calls[2][0].where.dueAt).toBeDefined();
    });
  });

  describe('listHistory (15.4 AC1/AC2)', () => {
    it('paginates final statuses with filters', async () => {
      repo.findAndCount.mockResolvedValue([[makeRequest({ status: 'done' })], 41]);
      const result = await service.listHistory(ACTOR, {
        tab: 'history',
        page: 2,
        pageSize: 20,
        categoryId: 'cat-1',
      });
      const args = repo.findAndCount.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(args.where.categoryId).toBe('cat-1');
      expect(result).toMatchObject({ total: 41, page: 2, pageSize: 20 });
    });

    it('floor filter resolves room ids first (no join+skip/take)', async () => {
      roomsRepo.find.mockResolvedValue([{ id: 'room-1' }, { id: 'room-2' }]);
      await service.listHistory(ACTOR, { tab: 'history', floor: 2 });
      expect(roomsRepo.find).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1', floor: 2 },
        select: ['id'],
      });
      expect(repo.findAndCount.mock.calls[0][0].where.roomId).toBeDefined();
    });
  });

  describe('getDetail (15.5 AC3)', () => {
    it('returns the timeline with actors and guest language', async () => {
      repo.findOne.mockResolvedValue({
        ...makeRequest({
          status: 'done',
          startedAt: new Date(),
          completedAt: new Date(),
        }),
        stay: { id: 'stay-1', guestName: 'Ivan Petrov', language: 'ru' },
        room: { id: 'room-1', floor: 2 },
        assignedTo: { id: 'user-2', name: 'Hany' },
        startedBy: { id: 'user-2', name: 'Hany' },
        completedBy: { id: 'user-1', name: 'Front Desk Fatma' },
        cancelledBy: null,
      });
      const detail = await service.getDetail(ACTOR, 'req-1');
      expect(detail).toMatchObject({
        guestLanguage: 'ru',
        startedBy: { name: 'Hany' },
        completedBy: { name: 'Front Desk Fatma' },
        cancelledBy: null,
      });
    });

    it('404 for unknown/cross-tenant ids', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getDetail(ACTOR, 'req-x')).rejects.toMatchObject({
        response: { code: 'REQUEST_NOT_FOUND' },
      });
    });
  });
});
