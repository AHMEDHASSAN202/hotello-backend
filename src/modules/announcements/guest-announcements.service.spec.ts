import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { Announcement } from './announcement.entity';
import { AnnouncementRead } from './announcement-read.entity';
import { GuestAnnouncementsService } from './guest-announcements.service';

const STAY = {
  id: 'stay-1',
  hotelId: 'hotel-1',
  roomId: 'room-1',
  stayType: 'all_inclusive',
  language: 'ru',
  status: 'active',
  room: { id: 'room-1', roomNumber: '204', floor: 2 },
  hotel: { id: 'hotel-1', timezone: 'Africa/Cairo', status: 'active' },
} as unknown as Stay;

const makeAnnouncement = (o: Partial<Announcement> = {}): Announcement =>
  ({
    id: 'ann-1',
    hotelId: 'hotel-1',
    titles: { en: 'Pool closed', ar: 'المسبح مغلق', ru: 'Бассейн закрыт' },
    bodies: { en: 'Maintenance 9-12', ar: 'صيانة' },
    infoEntryId: null,
    priority: false,
    audience: {},
    status: 'live',
    publishAtLocal: null,
    activeUntilLocal: null,
    publishedAt: new Date('2026-01-14T09:00:00Z'),
    expiredAt: null,
    retractedAt: null,
    createdAt: new Date('2026-01-14T08:00:00Z'),
    updatedAt: new Date('2026-01-14T09:00:00Z'),
    ...o,
  }) as Announcement;

describe('GuestAnnouncementsService', () => {
  let service: GuestAnnouncementsService;
  let repo: Record<string, jest.Mock>;
  let readsRepo: Record<string, jest.Mock>;
  let infoRepo: Record<string, jest.Mock>;
  let access: { getAccessState: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    readsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'read-new', readAt: new Date('2026-01-15T10:00:00Z'), ...d })),
      save: jest.fn(async (e) => e),
    };
    infoRepo = { find: jest.fn().mockResolvedValue([]) };
    access = {
      getAccessState: jest.fn().mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['announcements'],
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestAnnouncementsService,
        { provide: getRepositoryToken(Announcement), useValue: repo },
        { provide: getRepositoryToken(AnnouncementRead), useValue: readsRepo },
        { provide: getRepositoryToken(HotelInfoEntry), useValue: infoRepo },
        { provide: TenantAccessService, useValue: access },
      ],
    }).compile();
    service = moduleRef.get(GuestAnnouncementsService);
  });

  describe('module gating (19.4 AC4)', () => {
    it('module off → MODULE_NOT_ENABLED', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['requests'],
      });
      await expect(service.listForStay(STAY, {})).rejects.toMatchObject({
        response: { code: 'MODULE_NOT_ENABLED', module: 'announcements' },
      });
    });

    it('suspended or read-only hotel → HOTEL_UNAVAILABLE', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: true,
        enabledModules: ['announcements'],
      });
      const attempt = service.listForStay(STAY, {});
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'HOTEL_UNAVAILABLE' },
      });
    });
  });

  describe('listForStay (19.4 AC1/AC2, note 3 delta shape)', () => {
    it('full load returns only visible rows, priority first then newest, localized with EN fallback', async () => {
      repo.find.mockResolvedValue([
        makeAnnouncement({ id: 'ann-old', publishedAt: new Date('2026-01-10T09:00:00Z') }),
        makeAnnouncement({ id: 'ann-mismatch', audience: { floors: [9] } }),
        makeAnnouncement({
          id: 'ann-priority',
          priority: true,
          publishedAt: new Date('2026-01-12T09:00:00Z'),
        }),
        makeAnnouncement({ id: 'ann-new', publishedAt: new Date('2026-01-14T09:00:00Z') }),
      ]);
      const feed = await service.listForStay(STAY, {});
      expect(feed.data.map((d) => d.id)).toEqual(['ann-priority', 'ann-new', 'ann-old']);
      const first = feed.data[0] as { title: string; body: string };
      // Russian title, EN-fallback body (no ru body in the fixture).
      expect(first.title).toBe('Бассейн закрыт');
      expect(first.body).toBe('Maintenance 9-12');
      expect(feed.unreadCount).toBe(3);
      expect(typeof feed.serverTime).toBe('string');
      // Full loads never include tombstones.
      expect(feed.data.every((d) => d.active !== false)).toBe(true);
    });

    it('delta narrows data by the naiveUtc cursor and tombstones retracted rows, unreadCount stays full-set', async () => {
      // First repo.find call = full candidate set, second = changed rows.
      repo.find
        .mockResolvedValueOnce([
          makeAnnouncement({ id: 'ann-live' }),
          makeAnnouncement({ id: 'ann-gone', status: 'retracted' }),
        ])
        .mockResolvedValueOnce([
          makeAnnouncement({ id: 'ann-gone', status: 'retracted' }),
        ]);
      const feed = await service.listForStay(STAY, {
        updatedSince: '2026-01-15T08:00:00.000Z',
      });
      expect(feed.data).toEqual([{ id: 'ann-gone', active: false }]);
      expect(feed.unreadCount).toBe(1); // ann-live is still unread
      const where = repo.find.mock.calls[1][0].where;
      expect(where.updatedAt).toBeDefined();
    });

    it('reads mark rows and are excluded from unreadCount', async () => {
      repo.find.mockResolvedValue([
        makeAnnouncement({ id: 'ann-1' }),
        makeAnnouncement({ id: 'ann-2' }),
      ]);
      readsRepo.find.mockResolvedValue([
        { announcementId: 'ann-1', stayId: 'stay-1', readAt: new Date('2026-01-15T09:00:00Z') },
      ]);
      const feed = await service.listForStay(STAY, {});
      expect(feed.unreadCount).toBe(1);
      const read = feed.data.find((d) => d.id === 'ann-1') as { readAt: string | null };
      expect(read.readAt).toBe('2026-01-15T09:00:00.000Z');
    });

    it('expired-window live rows are invisible before the cron flips them', async () => {
      repo.find.mockResolvedValue([
        makeAnnouncement({ id: 'ann-window', activeUntilLocal: '2020-01-01 00:00' }),
      ]);
      const feed = await service.listForStay(STAY, {});
      expect(feed.data).toEqual([]);
      expect(feed.unreadCount).toBe(0);
    });

    it('resolves the Hotel Info chip and nulls dangling links', async () => {
      repo.find.mockResolvedValue([
        makeAnnouncement({ id: 'ann-1', infoEntryId: 'entry-1' }),
        makeAnnouncement({ id: 'ann-2', infoEntryId: 'entry-gone' }),
      ]);
      infoRepo.find.mockResolvedValue([
        {
          id: 'entry-1',
          section: 'facilities',
          names: { en: 'Pool', ru: 'Бассейн' },
        },
      ]);
      const feed = await service.listForStay(STAY, {});
      const withChip = feed.data.find((d) => d.id === 'ann-1') as {
        infoChip: { entryId: string; section: string; name: string } | null;
      };
      expect(withChip.infoChip).toEqual({
        entryId: 'entry-1',
        section: 'facilities',
        name: 'Бассейн',
      });
      const dangling = feed.data.find((d) => d.id === 'ann-2') as {
        infoChip: unknown;
      };
      expect(dangling.infoChip).toBeNull();
    });
  });

  describe('markRead (19.4 AC2)', () => {
    it('creates a lazy read row for a visible announcement', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement());
      const result = await service.markRead(STAY, 'ann-1');
      expect(readsRepo.create).toHaveBeenCalledWith({
        announcementId: 'ann-1',
        stayId: 'stay-1',
      });
      expect(typeof result.readAt).toBe('string');
    });

    it('is idempotent — an existing read row is returned untouched', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement());
      readsRepo.findOne.mockResolvedValue({
        readAt: new Date('2026-01-15T09:00:00Z'),
      });
      const result = await service.markRead(STAY, 'ann-1');
      expect(result.readAt).toBe('2026-01-15T09:00:00.000Z');
      expect(readsRepo.save).not.toHaveBeenCalled();
    });

    it('invisible announcements 404 (retracted / audience mismatch / other hotel)', async () => {
      repo.findOne.mockResolvedValue(makeAnnouncement({ status: 'retracted' }));
      await expect(service.markRead(STAY, 'ann-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      repo.findOne.mockResolvedValue(makeAnnouncement({ audience: { floors: [9] } }));
      await expect(service.markRead(STAY, 'ann-1')).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_NOT_FOUND' },
      });
      repo.findOne.mockResolvedValue(null);
      await expect(service.markRead(STAY, 'ann-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findOne).toHaveBeenLastCalledWith({
        where: { id: 'ann-1', hotelId: 'hotel-1' },
      });
    });
  });
});
