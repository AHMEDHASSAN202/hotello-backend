import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { Announcement } from './announcement.entity';
import { AnnouncementRead } from './announcement-read.entity';
import { TenantAnnouncementsService } from './tenant-announcements.service';

const HOTEL_ID = 'hotel-1';
const actor = { id: 'user-1', hotelId: HOTEL_ID } as unknown as TenantUser;

const makeAnnouncement = (o: Partial<Announcement> = {}): Announcement =>
  ({
    id: 'ann-1',
    hotelId: HOTEL_ID,
    titles: { en: 'Pool closed', ar: 'المسبح مغلق' },
    bodies: { en: 'Maintenance 9-12', ar: 'صيانة ٩-١٢' },
    infoEntryId: null,
    priority: false,
    audience: {},
    status: 'draft',
    publishAtLocal: null,
    activeUntilLocal: null,
    publishedAt: null,
    expiredAt: null,
    retractedAt: null,
    createdById: 'user-1',
    retractedById: null,
    createdAt: new Date('2026-01-10T08:00:00Z'),
    updatedAt: new Date('2026-01-10T08:00:00Z'),
    ...o,
  }) as Announcement;

const ACTIVE_STAYS = [
  { id: 'stay-1', hotelId: HOTEL_ID, roomId: 'room-1', stayType: 'all_inclusive', room: { id: 'room-1', roomNumber: '201', floor: 2 } },
  { id: 'stay-2', hotelId: HOTEL_ID, roomId: 'room-2', stayType: 'all_inclusive', room: { id: 'room-2', roomNumber: '202', floor: 2 } },
  { id: 'stay-3', hotelId: HOTEL_ID, roomId: 'room-3', stayType: 'room_only', guestName: 'Ivan Petrov', room: { id: 'room-3', roomNumber: '301', floor: 3 } },
  { id: 'stay-4', hotelId: HOTEL_ID, roomId: 'room-9', stayType: 'half_board', room: { id: 'room-9', roomNumber: '901', floor: 9 } },
] as unknown as Stay[];

const CONTENT = {
  titleEn: 'Pool closed',
  titleAr: 'المسبح مغلق',
  bodyEn: 'Maintenance 9-12',
  bodyAr: 'صيانة من ٩ إلى ١٢',
};

describe('TenantAnnouncementsService', () => {
  let service: TenantAnnouncementsService;
  let repo: Record<string, jest.Mock>;
  let readsRepo: { createQueryBuilder: jest.Mock };
  let staysRepo: Record<string, jest.Mock>;
  let hotelsRepo: Record<string, jest.Mock>;
  let infoRepo: Record<string, jest.Mock>;
  let auditLogs: { log: jest.Mock };
  let readCounts: jest.Mock;

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'ann-new', ...d })),
      save: jest.fn(async (e) => e),
    };
    readCounts = jest.fn().mockResolvedValue([]);
    readsRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb: Record<string, unknown> = {};
        for (const m of ['select', 'addSelect', 'where', 'groupBy']) {
          qb[m] = jest.fn(() => qb);
        }
        qb.getRawMany = readCounts;
        return qb;
      }),
    };
    staysRepo = { find: jest.fn().mockResolvedValue(ACTIVE_STAYS), findOne: jest.fn() };
    hotelsRepo = {
      findOne: jest.fn().mockResolvedValue({ id: HOTEL_ID, timezone: 'Africa/Cairo' }),
    };
    infoRepo = { findOne: jest.fn().mockResolvedValue(null) };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantAnnouncementsService,
        { provide: getRepositoryToken(Announcement), useValue: repo },
        { provide: getRepositoryToken(AnnouncementRead), useValue: readsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(HotelInfoEntry), useValue: infoRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(TenantAnnouncementsService);
  });

  describe('create (19.1 AC1-AC3, 19.2 AC1)', () => {
    it('send now → live with publishedAt, audits announcement.published', async () => {
      const view = await service.create(actor, { ...CONTENT, action: 'send' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelId: HOTEL_ID,
          status: 'live',
          createdById: 'user-1',
          titles: { en: 'Pool closed', ar: 'المسبح مغلق' },
        }),
      );
      expect(view.status).toBe('live');
      expect(view.publishedAt).not.toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'announcement.published',
          actorId: 'user-1',
          metadata: expect.objectContaining({ hotelId: HOTEL_ID }),
        }),
      );
    });

    it('schedule → scheduled, audits created + scheduled', async () => {
      const view = await service.create(actor, {
        ...CONTENT,
        action: 'schedule',
        publishAtLocal: '2030-01-01 09:00',
      });
      expect(view.status).toBe('scheduled');
      expect(view.publishAtLocal).toBe('2030-01-01 09:00');
      const actions = auditLogs.log.mock.calls.map((c) => c[0].action);
      expect(actions).toEqual(['announcement.created', 'announcement.scheduled']);
    });

    it('schedule without a datetime → ANNOUNCEMENT_SCHEDULE_REQUIRED', async () => {
      await expect(
        service.create(actor, { ...CONTENT, action: 'schedule' }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_SCHEDULE_REQUIRED' },
      });
    });

    it('schedule in the hotel-local past → ANNOUNCEMENT_SCHEDULE_IN_PAST', async () => {
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'schedule',
          publishAtLocal: '2020-01-01 09:00',
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_SCHEDULE_IN_PAST' },
      });
    });

    it('active-until before publish → ANNOUNCEMENT_WINDOW_INVALID', async () => {
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'schedule',
          publishAtLocal: '2030-01-01 09:00',
          activeUntilLocal: '2030-01-01 08:00',
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_WINDOW_INVALID' },
      });
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'send',
          activeUntilLocal: '2020-01-01 08:00',
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_WINDOW_INVALID' },
      });
    });

    it('stayId audience must belong to this hotel and be active', async () => {
      staysRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'send',
          audience: { stayId: 'stay-other' },
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_STAY_NOT_FOUND' },
      });
      expect(staysRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hotelId: HOTEL_ID, status: 'active' }),
        }),
      );
    });

    it('stayId combined with other dimensions → ANNOUNCEMENT_AUDIENCE_INVALID', async () => {
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'send',
          audience: { stayId: 'stay-1', floors: [2] },
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_AUDIENCE_INVALID' },
      });
    });

    // 21.3 AC3 groundwork — `stayIds` (the event-cancel-notice audience) must
    // not be silently dropped by normalizeAudience/resolveAudience: dropping
    // it would persist `audience: {}`, which `matchesAudience` resolves as
    // "everyone" — exactly the bug this coverage guards against.
    it('stayIds audience persists correctly and targets exactly those stays, not everyone', async () => {
      // First staysRepo.find call is resolveAudience's existence/active check;
      // the second is toViews' activeStays() call for the stats denominator.
      staysRepo.find.mockResolvedValueOnce(
        ACTIVE_STAYS.filter((s) => ['stay-1', 'stay-3'].includes(s.id)),
      );
      const view = await service.create(actor, {
        ...CONTENT,
        action: 'send',
        audience: { stayIds: ['stay-1', 'stay-3'] },
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ audience: { stayIds: ['stay-1', 'stay-3'] } }),
      );
      // 4 active stays exist; only the 2 targeted ones should match.
      expect(view.stats.audienceNow).toBe(2);
    });

    it('stayIds combined with other dimensions → ANNOUNCEMENT_AUDIENCE_INVALID', async () => {
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'send',
          audience: { stayIds: ['stay-1', 'stay-2'], floors: [2] },
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_AUDIENCE_INVALID' },
      });
    });

    it('stayId combined with stayIds → ANNOUNCEMENT_AUDIENCE_INVALID', async () => {
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'send',
          audience: { stayId: 'stay-1', stayIds: ['stay-2'] },
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_AUDIENCE_INVALID' },
      });
    });

    it('a stayIds entry that is not a valid/active stay of this hotel → ANNOUNCEMENT_STAY_NOT_FOUND', async () => {
      // Only 1 of the 2 requested ids resolves — simulates a foreign/checked-out stay.
      staysRepo.find.mockResolvedValueOnce(
        ACTIVE_STAYS.filter((s) => s.id === 'stay-1'),
      );
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'send',
          audience: { stayIds: ['stay-1', 'stay-other'] },
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_STAY_NOT_FOUND' },
      });
      expect(staysRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hotelId: HOTEL_ID, status: 'active' }),
        }),
      );
    });

    it('info entry link must exist, be active and belong to this hotel', async () => {
      await expect(
        service.create(actor, {
          ...CONTENT,
          action: 'send',
          infoEntryId: 'entry-9',
        }),
      ).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_INFO_ENTRY_NOT_FOUND' },
      });
      expect(infoRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'entry-9', hotelId: HOTEL_ID, isActive: true },
      });
    });
  });

  describe('update/cancel (19.2 AC1)', () => {
    it('draft and scheduled are editable; merges only touched maps', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement({ status: 'scheduled', publishAtLocal: '2030-01-01 09:00' }));
      const view = await service.update(actor, 'ann-1', { titleRu: 'Бассейн закрыт' });
      expect(view.titles.ru).toBe('Бассейн закрыт');
      expect(view.titles.en).toBe('Pool closed');
      expect(view.bodies.en).toBe('Maintenance 9-12');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'announcement.updated' }),
      );
    });

    it('live announcements are not editable (19.2 AC3) → 409 ANNOUNCEMENT_NOT_EDITABLE', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement({ status: 'live' }));
      const attempt = service.update(actor, 'ann-1', { titleEn: 'New' });
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_NOT_EDITABLE' },
      });
    });

    it('cancel reverts scheduled → draft and clears the schedule', async () => {
      repo.findOne.mockResolvedValue(
        makeAnnouncement({ status: 'scheduled', publishAtLocal: '2030-01-01 09:00' }),
      );
      const view = await service.cancelSchedule(actor, 'ann-1');
      expect(view.status).toBe('draft');
      expect(view.publishAtLocal).toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'announcement.schedule_canceled' }),
      );
    });

    it('cancel of a non-scheduled row → 409 ANNOUNCEMENT_INVALID_STATE', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement({ status: 'live' }));
      await expect(service.cancelSchedule(actor, 'ann-1')).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_INVALID_STATE' },
      });
    });

    it('sendNow flips draft → live', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement());
      const view = await service.sendNow(actor, 'ann-1');
      expect(view.status).toBe('live');
      expect(view.publishedAt).not.toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'announcement.published' }),
      );
    });
  });

  describe('retract (19.2 AC2)', () => {
    it('live → retracted with actor; reads are untouched', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement({ status: 'live', publishedAt: new Date() }));
      const view = await service.retract(actor, 'ann-1');
      expect(view.status).toBe('retracted');
      expect(view.retractedAt).not.toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'announcement.retracted',
          actorId: 'user-1',
        }),
      );
    });

    it('only live can be retracted → 409 ANNOUNCEMENT_INVALID_STATE', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement({ status: 'expired' }));
      await expect(service.retract(actor, 'ann-1')).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_INVALID_STATE' },
      });
    });
  });

  describe('list/get stats (19.3 AC1-AC2)', () => {
    it('list is newest-first for this hotel with live-computed stats', async () => {
      repo.find.mockResolvedValue([
        makeAnnouncement({ id: 'ann-1', status: 'live', audience: { floors: [2] } }),
      ]);
      readCounts.mockResolvedValue([{ announcementId: 'ann-1', count: '2' }]);
      const result = await service.list(actor);
      expect(repo.find).toHaveBeenCalledWith({
        where: { hotelId: HOTEL_ID },
        order: { createdAt: 'DESC' },
      });
      // 2 reads / 2 currently-matching active stays (floors: [2]).
      expect(result.data[0].stats).toEqual({ reads: 2, audienceNow: 2 });
    });

    it('get resolves the single-guest audience to name + room', async () => {
      repo.findOne.mockResolvedValue(
        makeAnnouncement({ audience: { stayId: 'stay-3' } }),
      );
      staysRepo.find.mockResolvedValue(ACTIVE_STAYS);
      const view = await service.get(actor, 'ann-1');
      expect(view.audienceStay).toEqual({ guestName: 'Ivan Petrov', roomNumber: '301' });
      expect(view.stats.audienceNow).toBe(1);
    });

    it('cross-tenant get is a 404 (isolation law)', async () => {
      repo.findOne.mockResolvedValue(null);
      const attempt = service.get(actor, 'ann-x');
      await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_NOT_FOUND' },
      });
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'ann-x', hotelId: HOTEL_ID },
      });
    });
  });

  describe('previewAudience (19.1 AC2)', () => {
    it('counts currently matching active stays', async () => {
      await expect(service.previewAudience(actor, {})).resolves.toEqual({ count: 4 });
      await expect(
        service.previewAudience(actor, { audience: { stayTypes: ['all_inclusive'] } }),
      ).resolves.toEqual({ count: 2 });
      await expect(
        service.previewAudience(actor, {
          audience: { stayTypes: ['all_inclusive'], floors: [2, 3] },
        }),
      ).resolves.toEqual({ count: 2 });
      expect(staysRepo.find).toHaveBeenCalledWith({
        where: { hotelId: HOTEL_ID, status: 'active' },
        relations: ['room'],
      });
    });

    it('rejects stayId combined with other dimensions', async () => {
      await expect(
        service.previewAudience(actor, {
          audience: { stayId: 'stay-1', roomIds: ['room-1'] },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stayIds targets exactly the listed stays, not everyone', async () => {
      await expect(
        service.previewAudience(actor, { audience: { stayIds: ['stay-1', 'stay-3'] } }),
      ).resolves.toEqual({ count: 2 });
    });

    it('rejects stayIds combined with other dimensions', async () => {
      await expect(
        service.previewAudience(actor, {
          audience: { stayIds: ['stay-1'], floors: [2] },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
