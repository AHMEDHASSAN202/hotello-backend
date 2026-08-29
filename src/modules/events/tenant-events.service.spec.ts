import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventBooking } from './event-booking.entity';
import { Event } from './event.entity';
import { TenantEventsService } from './tenant-events.service';

const HOTEL_ID = 'hotel-1';
const OTHER_HOTEL_ID = 'hotel-2';
const actor = { id: 'user-1', hotelId: HOTEL_ID } as unknown as TenantUser;

const makeEvent = (o: Partial<Event> = {}): Event =>
  ({
    id: 'event-1',
    hotelId: HOTEL_ID,
    titles: { ar: 'حفلة', en: 'Party' },
    descriptions: { ar: 'وصف', en: 'Description' },
    photoKeys: null,
    startAtLocal: '2026-06-01 18:00',
    endAtLocal: '2026-06-01 20:00',
    locationText: 'Pool deck',
    infoEntryId: null,
    capacity: 20,
    price: 0,
    includedFor: [],
    status: 'draft',
    cancelReason: null,
    createdById: 'user-1',
    publishedAt: null,
    cancelledAt: null,
    completedAt: null,
    cancelledById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as Event;

const baseCreateDto: CreateEventDto = {
  titleEn: 'Party',
  titleAr: 'حفلة',
  descriptionEn: 'Description',
  descriptionAr: 'وصف',
  startAtLocal: '2026-06-01 18:00',
  endAtLocal: '2026-06-01 20:00',
  locationText: 'Pool deck',
  capacity: 20,
  price: 0,
  includedFor: [],
};

describe('TenantEventsService (Story 21.2)', () => {
  let service: TenantEventsService;
  let eventsRepo: Record<string, jest.Mock>;
  let bookingsRepo: Record<string, jest.Mock>;
  let infoRepo: Record<string, jest.Mock>;
  let hotelsRepo: Record<string, jest.Mock>;
  let auditLogs: { log: jest.Mock };
  let bookingsQb: Record<string, jest.Mock>;
  let eventsQb: Record<string, jest.Mock>;

  beforeEach(async () => {
    bookingsQb = {};
    for (const m of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
      bookingsQb[m] = jest.fn().mockReturnValue(bookingsQb);
    }
    bookingsQb.getRawMany = jest.fn().mockResolvedValue([]);

    eventsQb = {};
    for (const m of ['where', 'andWhere', 'orderBy']) {
      eventsQb[m] = jest.fn().mockReturnValue(eventsQb);
    }
    eventsQb.getMany = jest.fn().mockResolvedValue([]);

    eventsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((o) => o),
      save: jest.fn(async (o) => ({ ...o, id: o.id ?? 'event-1' })),
      createQueryBuilder: jest.fn(() => eventsQb),
    };
    bookingsRepo = {
      createQueryBuilder: jest.fn(() => bookingsQb),
    };
    infoRepo = { findOne: jest.fn().mockResolvedValue(null) };
    hotelsRepo = {
      findOne: jest.fn().mockResolvedValue({ id: HOTEL_ID, timezone: 'Africa/Cairo' }),
    };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantEventsService,
        { provide: getRepositoryToken(Event), useValue: eventsRepo },
        { provide: getRepositoryToken(EventBooking), useValue: bookingsRepo },
        { provide: getRepositoryToken(HotelInfoEntry), useValue: infoRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(TenantEventsService);
  });

  describe('create', () => {
    it('creates a draft event and audits event.created', async () => {
      const result = await service.create(actor, baseCreateDto);
      expect(eventsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelId: HOTEL_ID,
          status: 'draft',
          titles: { ar: 'حفلة', en: 'Party' },
          descriptions: { ar: 'وصف', en: 'Description' },
        }),
      );
      expect(result.status).toBe('draft');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'event.created' }),
      );
    });

    it('rejects a missing Arabic/English title or description', async () => {
      await expect(
        service.create(actor, { ...baseCreateDto, titleAr: '' } as CreateEventDto),
      ).rejects.toMatchObject({ response: { code: 'EVENT_TITLES_REQUIRED' } });
      await expect(
        service.create(actor, { ...baseCreateDto, descriptionAr: '' } as CreateEventDto),
      ).rejects.toMatchObject({ response: { code: 'EVENT_DESCRIPTIONS_REQUIRED' } });
    });

    it('rejects an end time at or before the start time', async () => {
      await expect(
        service.create(actor, { ...baseCreateDto, endAtLocal: '2026-06-01 17:00' }),
      ).rejects.toMatchObject({ response: { code: 'EVENT_WINDOW_INVALID' } });
    });

    it('validates infoEntryId belongs to the hotel', async () => {
      infoRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create(actor, { ...baseCreateDto, infoEntryId: 'info-1' }),
      ).rejects.toMatchObject({ response: { code: 'EVENT_INFO_ENTRY_NOT_FOUND' } });

      infoRepo.findOne.mockResolvedValue({ id: 'info-1', hotelId: HOTEL_ID });
      await expect(
        service.create(actor, { ...baseCreateDto, infoEntryId: 'info-1' }),
      ).resolves.toBeDefined();
    });
  });

  describe('safe-edit matrix', () => {
    it('draft: every field is editable', async () => {
      eventsRepo.findOne.mockResolvedValue(makeEvent({ status: 'draft' }));
      const dto: UpdateEventDto = {
        titleEn: 'New title',
        titleAr: 'عنوان جديد',
        startAtLocal: '2026-07-01 10:00',
        endAtLocal: '2026-07-01 11:00',
        price: 100,
        includedFor: ['all_inclusive'],
        locationText: 'New spot',
        capacity: 5,
      };
      const result = await service.update(actor, 'event-1', dto);
      expect(result.startAtLocal).toBe('2026-07-01 10:00');
      expect(result.price).toBe(100);
      expect(result.capacity).toBe(5);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'event.updated' }),
      );
    });

    it('published: description/titles/photo-adjacent and capacity-increase pass', async () => {
      eventsRepo.findOne.mockResolvedValue(
        makeEvent({ status: 'published', capacity: 10 }),
      );
      const result = await service.update(actor, 'event-1', {
        titleEn: 'Updated title',
        titleAr: 'عنوان محدث',
        descriptionEn: 'Updated description',
        descriptionAr: 'وصف محدث',
        capacity: 15,
      });
      expect(result.titles.en).toBe('Updated title');
      expect(result.capacity).toBe(15);
    });

    it.each([
      ['startAtLocal', { startAtLocal: '2026-06-02 18:00' }],
      ['endAtLocal', { endAtLocal: '2026-06-01 21:00' }],
      ['price', { price: 50 }],
      ['includedFor', { includedFor: ['all_inclusive'] }],
      ['locationText', { locationText: 'Different spot' }],
      ['capacity decrease', { capacity: 5 }],
      ['infoEntryId', { infoEntryId: 'info-2' }],
    ])('published: changing %s is rejected with EVENT_NOT_SAFE_EDIT', async (_label, patch) => {
      eventsRepo.findOne.mockResolvedValue(
        makeEvent({ status: 'published', capacity: 10 }),
      );
      await expect(
        service.update(actor, 'event-1', patch as UpdateEventDto),
      ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_SAFE_EDIT' } });
    });

    it.each(['completed', 'cancelled'] as const)(
      '%s: any edit is rejected with EVENT_NOT_SAFE_EDIT',
      async (status) => {
        eventsRepo.findOne.mockResolvedValue(makeEvent({ status }));
        await expect(
          service.update(actor, 'event-1', { titleEn: 'x', titleAr: 'ص' }),
        ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_SAFE_EDIT' } });
        await expect(
          service.update(actor, 'event-1', { capacity: 999 }),
        ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_SAFE_EDIT' } });
      },
    );

    it('published: capacity increase to null (unlimited) is allowed', async () => {
      eventsRepo.findOne.mockResolvedValue(
        makeEvent({ status: 'published', capacity: 10 }),
      );
      const result = await service.update(actor, 'event-1', { capacity: null });
      expect(result.capacity).toBeNull();
    });

    it('is a no-op (no save/audit) when the dto changes nothing', async () => {
      eventsRepo.findOne.mockResolvedValue(makeEvent({ status: 'draft' }));
      await service.update(actor, 'event-1', {});
      expect(eventsRepo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

  describe('cross-tenant isolation', () => {
    it('get() 404s for a missing or foreign-hotel event', async () => {
      eventsRepo.findOne.mockResolvedValue(null);
      await expect(service.get(actor, 'event-1')).rejects.toMatchObject({
        response: { code: 'EVENT_NOT_FOUND' },
      });
      expect(eventsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'event-1', hotelId: HOTEL_ID },
      });
    });

    it('update() 404s for an event belonging to another hotel', async () => {
      // The repo mock enforces the hotelId filter itself in real TypeORM;
      // here we simulate the "not found for this hotel" outcome directly.
      eventsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update(actor, 'event-1', { titleEn: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_FOUND' } });
    });

    it('never leaks another hotel’s event even if the id exists elsewhere', async () => {
      // findOne is always called with this hotel's id — a row that belongs to
      // OTHER_HOTEL_ID would never be returned by a real hotelId-scoped query.
      eventsRepo.findOne.mockImplementation(({ where }) =>
        where.hotelId === OTHER_HOTEL_ID ? makeEvent({ hotelId: OTHER_HOTEL_ID }) : null,
      );
      await expect(service.get(actor, 'event-1')).rejects.toMatchObject({
        response: { code: 'EVENT_NOT_FOUND' },
      });
    });
  });

  describe('list', () => {
    it('upcoming: filters to published-future OR draft, batch-loads bookedCount', async () => {
      const events = [
        makeEvent({ id: 'e1', status: 'draft' }),
        makeEvent({ id: 'e2', status: 'published' }),
      ];
      eventsQb.getMany.mockResolvedValue(events);
      bookingsQb.getRawMany.mockResolvedValue([
        { eventId: 'e1', total: '3' },
        { eventId: 'e2', total: '5' },
      ]);

      const result = await service.list(actor, { tab: 'upcoming' });

      expect(eventsQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("e.status = 'draft'"),
        expect.objectContaining({ nowLocal: expect.any(String) }),
      );
      // One grouped query for the whole page, not one per row.
      expect(bookingsRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual([
        expect.objectContaining({ id: 'e1', bookedCount: 3 }),
        expect.objectContaining({ id: 'e2', bookedCount: 5 }),
      ]);
    });

    it('past: filters to completed only', async () => {
      await service.list(actor, { tab: 'past' });
      expect(eventsQb.andWhere).toHaveBeenCalledWith(`e.status = 'completed'`);
    });

    it('cancelled: filters to cancelled only', async () => {
      await service.list(actor, { tab: 'cancelled' });
      expect(eventsQb.andWhere).toHaveBeenCalledWith(`e.status = 'cancelled'`);
    });

    it('skips the booked-count query entirely for an empty page', async () => {
      eventsQb.getMany.mockResolvedValue([]);
      const result = await service.list(actor, { tab: 'past' });
      expect(result.data).toEqual([]);
      expect(bookingsRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('always scopes to the caller’s hotelId', async () => {
      await service.list(actor, { tab: 'upcoming' });
      expect(eventsRepo.createQueryBuilder).toHaveBeenCalledWith('e');
      expect(eventsQb.where).toHaveBeenCalledWith('e.hotelId = :hotelId', {
        hotelId: HOTEL_ID,
      });
    });
  });
});
