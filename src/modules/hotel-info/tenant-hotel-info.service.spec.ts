import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { HotelInfoEntry } from './hotel-info-entry.entity';
import { TenantHotelInfoService } from './tenant-hotel-info.service';

const HOTEL_ID = 'hotel-1';
const actor = { id: 'user-1', hotelId: HOTEL_ID } as unknown as TenantUser;

const makeEntry = (o: Partial<HotelInfoEntry> = {}): HotelInfoEntry =>
  ({
    id: 'entry-1',
    hotelId: HOTEL_ID,
    section: 'facilities',
    names: { ar: 'المسبح', en: 'Pool' },
    descriptions: null,
    structured: {},
    photos: [],
    sortOrder: 0,
    isActive: true,
    ...o,
  }) as HotelInfoEntry;

describe('TenantHotelInfoService (17.1)', () => {
  let service: TenantHotelInfoService;
  let repo: Record<string, jest.Mock>;
  let hotelsRepo: Record<string, jest.Mock>;
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'entry-new', photos: [], ...d })),
      save: jest.fn(async (e) => e),
      remove: jest.fn(async (e) => e),
    };
    hotelsRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: HOTEL_ID, checkoutTime: '12:00' }),
    };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantHotelInfoService,
        { provide: getRepositoryToken(HotelInfoEntry), useValue: repo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(TenantHotelInfoService);
  });

  const lastDiff = () =>
    auditLogs.log.mock.calls[auditLogs.log.mock.calls.length - 1][0].metadata
      .diff;

  describe('getOverview (AC1)', () => {
    it('groups rows by section in fixed order and projects checkoutTime from the hotel', async () => {
      repo.find.mockResolvedValue([
        makeEntry({ id: 'f2', section: 'facilities', sortOrder: 1 }),
        makeEntry({ id: 'f1', section: 'facilities', sortOrder: 0 }),
        makeEntry({ id: 'e1', section: 'essentials', names: {} }),
        makeEntry({ id: 'r1', section: 'house_rules' }),
      ]);
      const view = await service.getOverview(actor);
      expect(view.checkoutTime).toBe('12:00');
      expect(view.essentials?.id).toBe('e1');
      expect(view.about).toBeNull();
      expect(view.facilities.map((f) => f.id)).toEqual(['f1', 'f2']);
      expect(view.houseRules.map((r) => r.id)).toEqual(['r1']);
      expect(view.services).toEqual([]);
      expect(repo.find).toHaveBeenCalledWith({
        where: { hotelId: HOTEL_ID },
      });
    });
  });

  describe('upsertEssentials (AC1, AC5)', () => {
    it('creates the singleton with trimmed fields, dropping empties', async () => {
      const view = await service.upsertEssentials(actor, {
        wifiName: ' Lobby WiFi ',
        wifiPassword: 'sunrise2026',
        receptionPhone: '',
      });
      expect(repo.save).toHaveBeenCalled();
      expect(view?.structured).toEqual({
        wifiName: 'Lobby WiFi',
        wifiPassword: 'sunrise2026',
      });
    });

    it('AC5 + note 3 — audits hotel_info.updated with the wifi password masked', async () => {
      await service.upsertEssentials(actor, { wifiPassword: 'sunrise2026' });
      const call = auditLogs.log.mock.calls[0][0];
      expect(call.action).toBe('hotel_info.updated');
      expect(call.metadata.hotelId).toBe(HOTEL_ID);
      expect(JSON.stringify(call)).not.toContain('sunrise2026');
      expect(lastDiff().wifiPassword).toEqual({ changed: true });
    });

    it('updates the existing row and diffs only changed fields', async () => {
      repo.findOne.mockResolvedValue(
        makeEntry({
          id: 'ess-1',
          section: 'essentials',
          names: {},
          structured: { wifiName: 'Lobby WiFi', receptionPhone: '100' },
        }),
      );
      await service.upsertEssentials(actor, {
        wifiName: 'Lobby WiFi',
        receptionPhone: '200',
      });
      expect(lastDiff().receptionPhone).toEqual({ from: '100', to: '200' });
      expect(lastDiff().wifiName).toBeUndefined();
    });

    it('skips save and audit when nothing changed', async () => {
      repo.findOne.mockResolvedValue(
        makeEntry({
          section: 'essentials',
          names: {},
          structured: { wifiName: 'Lobby WiFi' },
        }),
      );
      await service.upsertEssentials(actor, { wifiName: 'Lobby WiFi' });
      expect(repo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('all-empty upsert deletes the row (and audits) — decision 2', async () => {
      repo.findOne.mockResolvedValue(
        makeEntry({
          id: 'ess-1',
          section: 'essentials',
          names: {},
          structured: { wifiName: 'Lobby WiFi' },
        }),
      );
      const view = await service.upsertEssentials(actor, {});
      expect(view).toBeNull();
      expect(repo.remove).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalled();
    });

    it('all-empty upsert with no existing row is a no-op', async () => {
      const view = await service.upsertEssentials(actor, {});
      expect(view).toBeNull();
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  describe('upsertAbout (AC1)', () => {
    it('creates the singleton from description fields', async () => {
      const view = await service.upsertAbout(actor, {
        descriptionEn: 'A calm beach hotel.',
        descriptionAr: 'فندق شاطئي هادئ.',
      });
      expect(view?.descriptions).toEqual({
        en: 'A calm beach hotel.',
        ar: 'فندق شاطئي هادئ.',
      });
    });

    it('clearing all text deletes the row only when the gallery is empty', async () => {
      repo.findOne.mockResolvedValue(
        makeEntry({
          id: 'about-1',
          section: 'about',
          names: {},
          descriptions: { en: 'Old' },
          photos: [{ id: 'p1', thumb: 't', detail: 'd' }],
        }),
      );
      const kept = await service.upsertAbout(actor, { descriptionEn: '' });
      expect(kept).not.toBeNull();
      expect(repo.remove).not.toHaveBeenCalled();

      repo.findOne.mockResolvedValue(
        makeEntry({
          id: 'about-1',
          section: 'about',
          names: {},
          descriptions: { en: 'Old' },
          photos: [],
        }),
      );
      const gone = await service.upsertAbout(actor, { descriptionEn: '' });
      expect(gone).toBeNull();
      expect(repo.remove).toHaveBeenCalled();
    });
  });

  describe('createEntry (AC1–AC3)', () => {
    it('AC2 — requires Arabic and English names', async () => {
      await expect(
        service.createEntry(actor, {
          section: 'facilities',
          nameEn: 'Pool',
        } as never),
      ).rejects.toMatchObject({
        response: { code: 'HOTEL_INFO_NAMES_REQUIRED' },
      });
    });

    it('creates a facility with windows + location note, sortOrder appended', async () => {
      repo.find.mockResolvedValue([makeEntry({ sortOrder: 3 })]);
      const view = await service.createEntry(actor, {
        section: 'facilities',
        nameEn: 'Pool',
        nameAr: 'المسبح',
        windows: [{ start: '08:00', end: '20:00' }],
        locationNoteEn: 'Building B',
      } as never);
      expect(view.sortOrder).toBe(4);
      expect(view.structured.windows).toEqual([
        { start: '08:00', end: '20:00' },
      ]);
      expect(view.structured.locationNote).toEqual({ en: 'Building B' });
    });

    it('creates a service with howTo and priceNote', async () => {
      const view = await service.createEntry(actor, {
        section: 'services',
        nameEn: 'Laundry',
        nameAr: 'غسيل الملابس',
        howToEn: 'Call reception',
        priceNoteEn: 'From 50 EGP',
      } as never);
      expect(view.structured.howTo).toEqual({ en: 'Call reception' });
      expect(view.structured.priceNote).toEqual({ en: 'From 50 EGP' });
    });

    it('rejects section-mismatched fields with HOTEL_INFO_FIELD_INVALID', async () => {
      await expect(
        service.createEntry(actor, {
          section: 'services',
          nameEn: 'Laundry',
          nameAr: 'غسيل',
          windows: [{ start: '08:00', end: '20:00' }],
        } as never),
      ).rejects.toMatchObject({
        response: { code: 'HOTEL_INFO_FIELD_INVALID' },
      });
      await expect(
        service.createEntry(actor, {
          section: 'facilities',
          nameEn: 'Pool',
          nameAr: 'المسبح',
          howToEn: 'Ask',
        } as never),
      ).rejects.toMatchObject({
        response: { code: 'HOTEL_INFO_FIELD_INVALID' },
      });
    });
  });

  describe('updateEntry (AC3, isolation)', () => {
    it('cross-tenant / unknown id → 404', async () => {
      await expect(
        service.updateEntry(actor, 'foreign-id', { nameEn: 'X' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne.mock.calls[0][0].where).toMatchObject({
        id: 'foreign-id',
        hotelId: HOTEL_ID,
      });
    });

    it('AC3 — toggles isActive with an audited diff', async () => {
      repo.findOne.mockResolvedValue(makeEntry());
      await service.updateEntry(actor, 'entry-1', { isActive: false } as never);
      expect(lastDiff().isActive).toEqual({ from: true, to: false });
    });

    it('AC2 — merges optional locales over existing names', async () => {
      repo.findOne.mockResolvedValue(makeEntry());
      const view = await service.updateEntry(actor, 'entry-1', {
        nameRu: 'Бассейн',
      } as never);
      expect(view.names).toEqual({ ar: 'المسبح', en: 'Pool', ru: 'Бассейн' });
    });
  });

  describe('reorder (AC3)', () => {
    const rows = [
      makeEntry({ id: 'a', sortOrder: 0 }),
      makeEntry({ id: 'b', sortOrder: 1 }),
      makeEntry({ id: 'c', sortOrder: 2 }),
    ];

    it('rewrites sortOrder from the array index and audits', async () => {
      repo.find.mockResolvedValue(rows);
      await service.reorder(actor, 'facilities', { entryIds: ['c', 'a', 'b'] });
      const saved = repo.save.mock.calls.map((c) => c[0]);
      expect(saved.find((e) => e.id === 'c').sortOrder).toBe(0);
      expect(saved.find((e) => e.id === 'a').sortOrder).toBe(1);
      expect(saved.find((e) => e.id === 'b').sortOrder).toBe(2);
      expect(auditLogs.log).toHaveBeenCalled();
    });

    it('rejects an id set that is not exactly this section — HOTEL_INFO_REORDER_INVALID', async () => {
      repo.find.mockResolvedValue(rows);
      for (const entryIds of [
        ['a', 'b'], // missing
        ['a', 'b', 'x'], // unknown
        ['a', 'a', 'b'], // duplicate
      ]) {
        await expect(
          service.reorder(actor, 'facilities', { entryIds }),
        ).rejects.toMatchObject({
          response: { code: 'HOTEL_INFO_REORDER_INVALID' },
        });
      }
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
