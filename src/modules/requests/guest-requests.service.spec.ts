import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PushService } from '../push/push.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { Stay } from '../tenant-stays/stay.entity';
import { GuestRequestsService } from './guest-requests.service';
import { GuestRequest } from './request.entity';
import { RequestCatalogViewService } from './request-catalog-view.service';

const STAY = {
  id: 'stay-1',
  hotelId: 'hotel-1',
  roomId: 'room-1',
  language: 'ru',
  room: { roomNumber: '204' },
  hotel: { timezone: 'Africa/Cairo' },
} as unknown as Stay;

const TOWELS = {
  item: {
    id: 'item-towels',
    categoryId: 'cat-hk',
    names: {
      ar: 'مناشف إضافية',
      en: 'Extra towels',
      ru: 'Дополнительные полотенца',
    },
    descriptions: { en: 'Fresh towels' },
    icon: 'layers',
    optionType: 'quantity',
    optionMin: 1,
    optionMax: 4,
  },
  enabled: true,
  slaMinutes: 20,
  categoryEnabled: true,
};

const WAKE_UP = {
  item: {
    id: 'item-wake',
    categoryId: 'cat-fd',
    names: { ar: 'مكالمة إيقاظ', en: 'Wake-up call' },
    descriptions: null,
    icon: 'alarm-clock',
    optionType: 'time',
    optionMin: null,
    optionMax: null,
  },
  enabled: true,
  slaMinutes: 15,
  categoryEnabled: true,
};

const PLAIN = {
  item: {
    id: 'item-clean',
    categoryId: 'cat-hk',
    names: { ar: 'تنظيف الغرفة', en: 'Room cleaning' },
    descriptions: null,
    icon: 'sparkles',
    optionType: null,
    optionMin: null,
    optionMax: null,
  },
  enabled: true,
  slaMinutes: 45,
  categoryEnabled: true,
};

describe('GuestRequestsService', () => {
  let service: GuestRequestsService;
  let repo: {
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let catalogView: {
    getEffectiveCatalog: jest.Mock;
    findItemForHotel: jest.Mock;
  };
  let access: { getAccessState: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let push: { notify: jest.Mock };

  beforeEach(async () => {
    repo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => ({
        id: 'req-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelledReason: null,
        ...row,
      })),
    };
    catalogView = {
      getEffectiveCatalog: jest.fn().mockResolvedValue([]),
      findItemForHotel: jest.fn().mockResolvedValue(TOWELS),
    };
    access = {
      getAccessState: jest.fn().mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['requests'],
      }),
    };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    push = { notify: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestRequestsService,
        { provide: getRepositoryToken(GuestRequest), useValue: repo },
        { provide: RequestCatalogViewService, useValue: catalogView },
        { provide: TenantAccessService, useValue: access },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: PushService, useValue: push },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, fallback: string) => fallback) },
        },
      ],
    }).compile();
    service = moduleRef.get(GuestRequestsService);
  });

  describe('module/subscription gate (15.2 AC1/AC6, spec note 3)', () => {
    it('MODULE_NOT_ENABLED when requests is not in the plan', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['fnb'],
      });
      await expect(service.getCatalog(STAY)).rejects.toMatchObject({
        response: { code: 'MODULE_NOT_ENABLED', module: 'requests' },
      });
    });

    it('HOTEL_UNAVAILABLE when the subscription is read-only', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: true,
        enabledModules: ['requests'],
      });
      await expect(service.submit(STAY, { itemId: 'x' })).rejects.toMatchObject(
        { response: { code: 'HOTEL_UNAVAILABLE' } },
      );
    });
  });

  describe('getCatalog (15.2 AC2)', () => {
    beforeEach(() => {
      catalogView.getEffectiveCatalog.mockResolvedValue([
        {
          category: {
            id: 'cat-hk',
            names: { en: 'Housekeeping', ru: 'Уборка' },
            icon: 'sparkles',
          },
          enabled: true,
          items: [
            TOWELS,
            { ...PLAIN, enabled: false },
            {
              // custom hotel item without a ru translation (15.1 AC4)
              item: {
                id: 'item-custom',
                categoryId: 'cat-hk',
                names: { ar: 'خدمة خاصة', en: 'Special service' },
                descriptions: { ar: 'وصف', en: 'A special thing' },
                icon: 'star',
                optionType: null,
                optionMin: null,
                optionMax: null,
              },
              enabled: true,
              slaMinutes: 30,
              categoryEnabled: true,
            },
          ],
        },
        {
          category: { id: 'cat-mt', names: { en: 'Maintenance' }, icon: 'wrench' },
          enabled: false,
          items: [TOWELS],
        },
        {
          category: { id: 'cat-empty', names: { en: 'Empty' }, icon: 'bell' },
          enabled: true,
          items: [],
        },
      ]);
    });

    it('returns enabled items localized to the stay language', async () => {
      const result = await service.getCatalog(STAY);
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].name).toBe('Уборка');
      expect(result.categories[0].items.map((i) => i.id)).toEqual([
        'item-towels',
        'item-custom',
      ]);
      expect(result.categories[0].items[0].name).toBe(
        'Дополнительные полотенца',
      );
    });

    it('15.1 AC4 — custom items fall back to en per field for the guest', async () => {
      const result = await service.getCatalog(STAY);
      const custom = result.categories[0].items[1];
      expect(custom.name).toBe('Special service');
      expect(custom.description).toBe('A special thing');
    });
  });

  describe('submit (15.2 AC3–AC5)', () => {
    it('AC4 — binds hotel/stay/room + number from the session stay', async () => {
      await service.submit(STAY, { itemId: 'item-towels', optionValue: '2' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelId: 'hotel-1',
          stayId: 'stay-1',
          roomId: 'room-1',
          roomNumber: '204',
          status: 'new',
        }),
      );
    });

    it('snapshots names, icon and SLA; computes dueAt (15.1 AC5 / note 6)', async () => {
      const before = Date.now();
      await service.submit(STAY, { itemId: 'item-towels', optionValue: '2' });
      const saved = repo.save.mock.calls[0][0];
      expect(saved.itemNames).toEqual(TOWELS.item.names);
      expect(saved.itemIcon).toBe('layers');
      expect(saved.slaTargetMinutes).toBe(20);
      const expectedDue = before + 20 * 60_000;
      expect(Math.abs(saved.dueAt.getTime() - expectedDue)).toBeLessThan(5000);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'request.created', actorId: null }),
      );
    });

    it('emits staff_available to requests.update holders, muted key respected (26.4 AC2 ②)', async () => {
      await service.submit(STAY, { itemId: 'item-towels', optionValue: '2' });
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        {
          tenantPermission: 'requests.update',
          mutedHintKey: 'staffPush.availableMuted',
        },
        'staff_available',
        expect.objectContaining({
          refId: 'req-1',
          vars: expect.objectContaining({
            feed: 'requests',
            id: 'req-1',
            roomNumber: '204',
            names: TOWELS.item.names,
          }),
        }),
      );
    });

    it('a push failure never fails the submission', async () => {
      push.notify.mockRejectedValueOnce(new Error('dispatch exploded'));
      const view = await service.submit(STAY, { itemId: 'item-towels', optionValue: '2' });
      expect(view).toBeDefined();
    });

    it('AC5 — open-request throttle: the 6th open request is rejected 429', async () => {
      repo.count.mockResolvedValueOnce(5);
      await expect(
        service.submit(STAY, { itemId: 'item-towels', optionValue: '2' }),
      ).rejects.toMatchObject({
        status: 429,
        response: { code: 'REQUEST_LIMIT_OPEN', limit: 5 },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('AC5 — daily throttle: the 16th request of the hotel-local day is rejected', async () => {
      repo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(15);
      await expect(
        service.submit(STAY, { itemId: 'item-towels', optionValue: '2' }),
      ).rejects.toMatchObject({
        status: 429,
        response: { code: 'REQUEST_LIMIT_DAILY', limit: 15 },
      });
    });

    it('404 for an item unknown to this hotel (cross-tenant custom id)', async () => {
      catalogView.findItemForHotel.mockResolvedValue(null);
      await expect(
        service.submit(STAY, { itemId: 'other-hotels-item' }),
      ).rejects.toMatchObject({ response: { code: 'REQUEST_ITEM_NOT_FOUND' } });
    });

    it('409 for a disabled item or disabled category', async () => {
      catalogView.findItemForHotel.mockResolvedValue({
        ...TOWELS,
        enabled: false,
      });
      await expect(
        service.submit(STAY, { itemId: 'item-towels', optionValue: '2' }),
      ).rejects.toMatchObject({ response: { code: 'REQUEST_ITEM_DISABLED' } });

      catalogView.findItemForHotel.mockResolvedValue({
        ...TOWELS,
        categoryEnabled: false,
      });
      await expect(
        service.submit(STAY, { itemId: 'item-towels', optionValue: '2' }),
      ).rejects.toMatchObject({ response: { code: 'REQUEST_ITEM_DISABLED' } });
    });

    describe('option validation (15.1 AC3)', () => {
      it.each([
        ['missing quantity', TOWELS, undefined],
        ['quantity below min', TOWELS, '0'],
        ['quantity above max', TOWELS, '5'],
        ['non-numeric quantity', TOWELS, 'two'],
        ['missing time', WAKE_UP, undefined],
        ['malformed time', WAKE_UP, '25:00'],
        ['option sent for optionless item', PLAIN, '2'],
      ])('rejects %s with REQUEST_OPTION_INVALID', async (_label, item, value) => {
        catalogView.findItemForHotel.mockResolvedValue(item);
        await expect(
          service.submit(STAY, { itemId: item.item.id, optionValue: value }),
        ).rejects.toMatchObject({
          response: { code: 'REQUEST_OPTION_INVALID' },
        });
      });

      it('accepts a quantity in range and a valid time', async () => {
        catalogView.findItemForHotel.mockResolvedValue(TOWELS);
        await service.submit(STAY, { itemId: 'item-towels', optionValue: '4' });
        expect(repo.save.mock.calls[0][0].optionValue).toBe('4');

        catalogView.findItemForHotel.mockResolvedValue(WAKE_UP);
        await service.submit(STAY, { itemId: 'item-wake', optionValue: '07:30' });
        expect(repo.save.mock.calls[1][0]).toMatchObject({
          optionType: 'time',
          optionValue: '07:30',
        });
      });
    });

    it('stores the trimmed note with the stay language tag', async () => {
      await service.submit(STAY, {
        itemId: 'item-towels',
        optionValue: '2',
        note: '  Побыстрее, пожалуйста  ',
      });
      expect(repo.save.mock.calls[0][0]).toMatchObject({
        note: 'Побыстрее, пожалуйста',
        noteLanguage: 'ru',
      });
    });

    it('stores null note/noteLanguage when the note is blank', async () => {
      await service.submit(STAY, {
        itemId: 'item-towels',
        optionValue: '2',
        note: '   ',
      });
      expect(repo.save.mock.calls[0][0]).toMatchObject({
        note: null,
        noteLanguage: null,
      });
    });
  });

  describe('listForStay (15.3 AC1/AC2, note 4 delta polling)', () => {
    it('scopes to the session stay and localizes item names', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'req-1',
          itemNames: { en: 'Extra towels', ru: 'Дополнительные полотенца' },
          itemIcon: 'layers',
          status: 'new',
          slaTargetMinutes: 20,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const result = await service.listForStay(STAY, {});
      expect(repo.find).toHaveBeenCalledWith({
        where: { stayId: 'stay-1' },
        order: { createdAt: 'DESC' },
      });
      expect(result.data[0].itemName).toBe('Дополнительные полотенца');
      expect(typeof result.serverTime).toBe('string');
    });

    it('updatedSince returns deltas only (no status filter — cancelled rows flow too)', async () => {
      await service.listForStay(STAY, {
        updatedSince: '2026-08-22T10:00:00.000Z',
      });
      const where = repo.find.mock.calls[0][0].where;
      expect(where.stayId).toBe('stay-1');
      expect(where.updatedAt).toBeDefined();
      expect(where.status).toBeUndefined();
    });
  });

  describe('cancelOwn (15.3 AC3 / 15.5 AC1)', () => {
    it('cancels an own `new` request with reason guest', async () => {
      repo.findOne.mockResolvedValue({
        id: 'req-1',
        stayId: 'stay-1',
        status: 'new',
        itemNames: { en: 'Extra towels' },
        itemIcon: 'layers',
        slaTargetMinutes: 20,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await service.cancelOwn(STAY, 'req-1');
      expect(repo.save.mock.calls[0][0]).toMatchObject({
        status: 'cancelled',
        cancelledReason: 'guest',
        cancelledById: null,
      });
      expect(result.status).toBe('cancelled');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'request.cancelled',
          metadata: expect.objectContaining({ reason: 'guest' }),
        }),
      );
    });

    it('409 REQUEST_INVALID_STATUS once work has started', async () => {
      repo.findOne.mockResolvedValue({
        id: 'req-1',
        stayId: 'stay-1',
        status: 'in_progress',
      });
      await expect(service.cancelOwn(STAY, 'req-1')).rejects.toMatchObject({
        response: { code: 'REQUEST_INVALID_STATUS', status: 'in_progress' },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('never pushes (23.4 recorded decision) — a guest-initiated cancel never notifies; the guest already knows, they did it', async () => {
      // The push hooks added for Epic 23.4 live only on the STAFF-side
      // TenantRequestsService.cancel() (tenant-requests.service.spec.ts).
      // GuestRequestsService now DOES hold a PushService dependency (Epic
      // 26 — `submit()` pushes `staff_available`), but `cancelOwn()` itself
      // never calls it.
      repo.findOne.mockResolvedValue({ id: 'req-1', stayId: 'stay-1', status: 'new' });
      await service.cancelOwn(STAY, 'req-1');
      expect(push.notify).not.toHaveBeenCalled();
    });

    it("404 for another stay's request (id scoped to own stay)", async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.cancelOwn(STAY, 'req-x')).rejects.toMatchObject({
        response: { code: 'REQUEST_NOT_FOUND' },
      });
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'req-x', stayId: 'stay-1' },
      });
    });
  });
});
