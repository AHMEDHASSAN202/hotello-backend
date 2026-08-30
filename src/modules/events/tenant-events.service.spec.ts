import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAnnouncementsService } from '../announcements/tenant-announcements.service';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import * as announceUtil from './event-announce.util';
import { CancelEventDto } from './dto/cancel-event.dto';
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
  let staysRepo: Record<string, jest.Mock>;
  let auditLogs: { log: jest.Mock };
  let bookingsQb: Record<string, jest.Mock>;
  let eventsQb: Record<string, jest.Mock>;
  let managerEvents: { findOne: jest.Mock; save: jest.Mock };
  let managerBookings: { find: jest.Mock; save: jest.Mock };
  let manager: { getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let announcements: { create: jest.Mock };
  let access: { getAccessState: jest.Mock };

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
    // Default: every stay resolves as active — individual cancel() tests
    // override this to simulate checked-out guests (final-review C2).
    staysRepo = {
      find: jest.fn(async ({ where }: { where: { id: { value: string[] } } }) =>
        (where.id.value as string[]).map((id) => ({ id, status: 'active' })),
      ),
    };
    auditLogs = { log: jest.fn() };

    managerEvents = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (e) => e),
    };
    managerBookings = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (rows) => rows),
    };
    manager = {
      getRepository: jest.fn((entity) =>
        entity === Event ? managerEvents : managerBookings,
      ),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };
    announcements = { create: jest.fn().mockResolvedValue({ id: 'ann-1' }) };
    // Default plan has both modules; the announcements-disabled tests
    // override this (final-review — the internal announcements.create()
    // call bypasses the @RequireModule HTTP guard).
    access = {
      getAccessState: jest.fn().mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['events', 'announcements'],
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantEventsService,
        { provide: getRepositoryToken(Event), useValue: eventsRepo },
        { provide: getRepositoryToken(EventBooking), useValue: bookingsRepo },
        { provide: getRepositoryToken(HotelInfoEntry), useValue: infoRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: DataSource, useValue: dataSource },
        { provide: TenantAnnouncementsService, useValue: announcements },
        { provide: TenantAccessService, useValue: access },
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

    // final-review — the safe-edit hole: an unlimited published event
    // (capacity === null) used to accept ANY new capacity, including one
    // below the seats already sold. Only null → null and finite increases
    // are safe.
    it('published: unlimited (null) capacity → a finite number is rejected with EVENT_NOT_SAFE_EDIT', async () => {
      eventsRepo.findOne.mockResolvedValue(
        makeEvent({ status: 'published', capacity: null }),
      );
      await expect(
        service.update(actor, 'event-1', { capacity: 5 }),
      ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_SAFE_EDIT' } });
      expect(eventsRepo.save).not.toHaveBeenCalled();
    });

    it('published: unlimited (null) capacity → null stays allowed (a no-op edit)', async () => {
      eventsRepo.findOne.mockResolvedValue(
        makeEvent({ status: 'published', capacity: null }),
      );
      const result = await service.update(actor, 'event-1', {
        capacity: null,
        descriptionEn: 'Updated description',
        descriptionAr: 'وصف محدث',
      });
      expect(result.capacity).toBeNull();
    });

    it('published: a finite capacity increase is allowed, a decrease is not', async () => {
      eventsRepo.findOne.mockResolvedValue(
        makeEvent({ status: 'published', capacity: 10 }),
      );
      await expect(
        service.update(actor, 'event-1', { capacity: 11 }),
      ).resolves.toMatchObject({ capacity: 11 });

      eventsRepo.findOne.mockResolvedValue(
        makeEvent({ status: 'published', capacity: 10 }),
      );
      await expect(
        service.update(actor, 'event-1', { capacity: 9 }),
      ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_SAFE_EDIT' } });
    });

    it('is a no-op (no save/audit) when the dto changes nothing', async () => {
      eventsRepo.findOne.mockResolvedValue(makeEvent({ status: 'draft' }));
      await service.update(actor, 'event-1', {});
      expect(eventsRepo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

  describe('publish (Story 21.3 AC1)', () => {
    const futureDraft = (o: Partial<Event> = {}) =>
      makeEvent({ status: 'draft', startAtLocal: '2030-01-01 10:00', ...o });

    it('happy path: draft → published, creates a linked announcement (source=event_publish)', async () => {
      eventsRepo.findOne.mockResolvedValue(futureDraft());
      const result = await service.publish(actor, 'event-1', {});

      expect(result.status).toBe('published');
      expect(eventsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published', publishedAt: expect.any(Date) }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'event.published' }),
      );
      expect(announcements.create).toHaveBeenCalledTimes(1);
      expect(announcements.create).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          titleEn: 'Party',
          titleAr: 'حفلة',
          bodyEn: expect.stringContaining('Party'),
          bodyAr: expect.stringContaining('حفلة'),
          action: 'send',
          audience: {},
        }),
        { source: 'event_publish', eventId: 'event-1' },
      );
    });

    it('announce: false publishes but creates no announcement', async () => {
      eventsRepo.findOne.mockResolvedValue(futureDraft());
      const result = await service.publish(actor, 'event-1', { announce: false });
      expect(result.status).toBe('published');
      expect(announcements.create).not.toHaveBeenCalled();
    });

    it('rejects a non-future startAtLocal', async () => {
      eventsRepo.findOne.mockResolvedValue(
        futureDraft({ startAtLocal: '2020-01-01 10:00' }),
      );
      await expect(service.publish(actor, 'event-1', {})).rejects.toMatchObject({
        response: { code: 'EVENT_START_IN_PAST' },
      });
      expect(eventsRepo.save).not.toHaveBeenCalled();
      expect(announcements.create).not.toHaveBeenCalled();
    });

    it('rejects a non-draft event', async () => {
      eventsRepo.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      await expect(service.publish(actor, 'event-1', {})).rejects.toMatchObject({
        response: { code: 'EVENT_NOT_PUBLISHABLE' },
      });
      expect(announcements.create).not.toHaveBeenCalled();
    });

    // final-review — the internal announcements.create() call bypasses the
    // @RequireModule('announcements') guard that only gates the HTTP layer:
    // a hotel on a plan with `events` but not `announcements` would collect
    // announcement rows nothing renders. The publish itself still succeeds.
    it('announcements module not in the plan → publishes with zero announcements created', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['events'],
      });
      eventsRepo.findOne.mockResolvedValue(futureDraft());

      const result = await service.publish(actor, 'event-1', {});

      expect(result.status).toBe('published');
      expect(eventsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published' }),
      );
      expect(announcements.create).not.toHaveBeenCalled();
    });

    // final-review — composePublishAnnouncement() used to sit OUTSIDE the
    // try/catch (cancel() already had it inside): a throw there would have
    // turned an already-committed publish into a 500.
    it('a compose failure is logged but does not fail the publish (already-committed)', async () => {
      eventsRepo.findOne.mockResolvedValue(futureDraft());
      const composeSpy = jest
        .spyOn(announceUtil, 'composePublishAnnouncement')
        .mockImplementation(() => {
          throw new Error('compose blew up');
        });
      const loggerSpy = jest
        .spyOn((service as unknown as { logger: { error: (msg: string) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      const result = await service.publish(actor, 'event-1', {});

      expect(result.status).toBe('published');
      expect(announcements.create).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('event-1'));
      composeSpy.mockRestore();
      loggerSpy.mockRestore();
    });

    it('an announcement-pipeline failure is logged but does not fail the publish (already-committed)', async () => {
      eventsRepo.findOne.mockResolvedValue(futureDraft());
      announcements.create.mockRejectedValue(new Error('announcement pipeline down'));
      const loggerSpy = jest
        .spyOn((service as unknown as { logger: { error: (msg: string) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      const result = await service.publish(actor, 'event-1', {});

      expect(result.status).toBe('published');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('event-1'));
      loggerSpy.mockRestore();
    });
  });

  describe('cancel (Story 21.2 AC3)', () => {
    const makeBooking = (o: Record<string, unknown> = {}) => ({
      id: 'booking-1',
      hotelId: HOTEL_ID,
      eventId: 'event-1',
      stayId: 'stay-1',
      status: 'booked',
      cancelledBy: null,
      cancelledAt: null,
      cancelledReason: null,
      ...o,
    });

    it('cascades every active booking to cancelled/staff, releases capacity, and creates exactly one targeted announcement', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      const bookings = [
        makeBooking({ id: 'b1', stayId: 'stay-1' }),
        makeBooking({ id: 'b2', stayId: 'stay-2' }),
        makeBooking({ id: 'b3', stayId: 'stay-1' }), // same stay booked twice
      ];
      managerBookings.find.mockResolvedValue(bookings);

      const result = await service.cancel(actor, 'event-1', { reason: 'Storm warning' });

      expect(result.status).toBe('cancelled');
      expect(result.cancelReason).toBe('Storm warning');
      // Lock discipline — the event row is locked pessimistic_write before anything else.
      expect(managerEvents.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-1', hotelId: HOTEL_ID },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      // All 3 bookings flip, reason copied, capacity fully released.
      expect(bookings.every((b) => b.status === 'cancelled')).toBe(true);
      expect(bookings.every((b) => b.cancelledBy === 'staff')).toBe(true);
      expect(bookings.every((b) => b.cancelledReason === 'Storm warning')).toBe(true);
      expect(managerBookings.save).toHaveBeenCalledWith(bookings);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'event.cancelled',
          metadata: expect.objectContaining({ diff: { bookingsCancelled: 3 } }),
        }),
      );

      // Exactly one targeted announcement, audience = the N=2 distinct stay ids.
      expect(announcements.create).toHaveBeenCalledTimes(1);
      expect(announcements.create).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'send',
          audience: { stayIds: ['stay-1', 'stay-2'] },
        }),
        {
          source: 'event_cancel',
          eventId: 'event-1',
          dropUnresolvedStays: true,
        },
      );
    });

    // final-review — the checkout race between cancel()'s own active-stay
    // filter and resolveAudience()'s re-validation: a guest leaving in that
    // window used to 400 the whole notice, silently dropping it for every
    // guest still in the hotel. The flag makes the announcements side filter
    // instead of throw.
    it('passes dropUnresolvedStays so a checkout mid-cancel cannot drop the notice for the remaining guests', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      managerBookings.find.mockResolvedValue([
        makeBooking({ id: 'b1', stayId: 'stay-1' }),
        makeBooking({ id: 'b2', stayId: 'stay-2' }),
      ]);

      await service.cancel(actor, 'event-1', { reason: 'Storm warning' });

      expect(announcements.create).toHaveBeenCalledWith(
        actor,
        expect.anything(),
        expect.objectContaining({ dropUnresolvedStays: true }),
      );
    });

    it('announcements module not in the plan → cancel succeeds with zero announcements created', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['events'],
      });
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      const bookings = [makeBooking({ id: 'b1', stayId: 'stay-1' })];
      managerBookings.find.mockResolvedValue(bookings);

      const result = await service.cancel(actor, 'event-1', { reason: 'Storm warning' });

      expect(result.status).toBe('cancelled');
      expect(bookings[0].status).toBe('cancelled');
      expect(announcements.create).not.toHaveBeenCalled();
    });

    it('zero active bookings → no announcement created', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      managerBookings.find.mockResolvedValue([]);

      await service.cancel(actor, 'event-1', { reason: 'No guests booked' });

      expect(announcements.create).not.toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ diff: { bookingsCancelled: 0 } }),
        }),
      );
    });

    // final-review C2 — bookings deliberately survive checkout (21.5 AC3),
    // so a booked guest's stay can be `checked_out` by the time the event is
    // cancelled. resolveAudience() 400s if ANY id in the audience fails to
    // resolve to an active stay — the regression this guards against.
    it('mix of active and checked-out attendees: cancel still succeeds and notifies only the resident guests', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      const bookings = [
        makeBooking({ id: 'b1', stayId: 'stay-active' }),
        makeBooking({ id: 'b2', stayId: 'stay-checked-out' }),
      ];
      managerBookings.find.mockResolvedValue(bookings);
      staysRepo.find.mockResolvedValue([{ id: 'stay-active', status: 'active' }]);

      const result = await service.cancel(actor, 'event-1', { reason: 'Storm warning' });

      expect(result.status).toBe('cancelled');
      expect(bookings.every((b) => b.status === 'cancelled')).toBe(true);
      expect(announcements.create).toHaveBeenCalledTimes(1);
      expect(announcements.create).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ audience: { stayIds: ['stay-active'] } }),
        expect.objectContaining({ source: 'event_cancel', eventId: 'event-1' }),
      );
    });

    it('every booked guest already checked out: cancel succeeds, skips the announcement entirely', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      const bookings = [makeBooking({ id: 'b1', stayId: 'stay-checked-out' })];
      managerBookings.find.mockResolvedValue(bookings);
      staysRepo.find.mockResolvedValue([]); // no stay in the list is still active

      const result = await service.cancel(actor, 'event-1', { reason: 'Storm warning' });

      expect(result.status).toBe('cancelled');
      expect(announcements.create).not.toHaveBeenCalled();
    });

    it('an announcement-pipeline failure is logged but does not fail the cancel (already-committed)', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      managerBookings.find.mockResolvedValue([makeBooking({ id: 'b1', stayId: 'stay-1' })]);
      announcements.create.mockRejectedValue(new Error('announcement pipeline down'));
      const loggerSpy = jest
        .spyOn((service as unknown as { logger: { error: (msg: string) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      const result = await service.cancel(actor, 'event-1', { reason: 'Storm warning' });

      expect(result.status).toBe('cancelled');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('event-1'));
      loggerSpy.mockRestore();
    });

    it('a stay-lookup failure while building the notice audience is logged but does not fail the cancel (already-committed)', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'published' }));
      managerBookings.find.mockResolvedValue([makeBooking({ id: 'b1', stayId: 'stay-1' })]);
      staysRepo.find.mockRejectedValue(new Error('db timeout'));
      const loggerSpy = jest
        .spyOn((service as unknown as { logger: { error: (msg: string) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      const result = await service.cancel(actor, 'event-1', { reason: 'Storm warning' });

      expect(result.status).toBe('cancelled');
      expect(announcements.create).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('event-1'));
      loggerSpy.mockRestore();
    });

    it('rejects a non-published event', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'draft' }));
      await expect(
        service.cancel(actor, 'event-1', { reason: 'x' } as CancelEventDto),
      ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_CANCELLABLE' } });
      expect(announcements.create).not.toHaveBeenCalled();
    });

    it('cross-tenant/missing event → 404 inside the locked transaction', async () => {
      managerEvents.findOne.mockResolvedValue(null);
      await expect(
        service.cancel(actor, 'event-1', { reason: 'x' } as CancelEventDto),
      ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_FOUND' } });
    });

    // Story 21.2 AC3's "capacity fully released" claim also implies a
    // subsequent booking attempt on the cancelled event returns 409
    // EVENT_NOT_BOOKABLE. That assertion needs Task 7's book() to exist —
    // per the plan's task ordering (Task 7 runs after Task 6), it's deferred
    // into Task 7's own test suite rather than stubbed here.
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
    it('upcoming: filters to published OR draft (any start time), batch-loads bookedCount', async () => {
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
        `(e.status = 'draft' OR e.status = 'published')`,
      );
      // One grouped query for the whole page, not one per row.
      expect(bookingsRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual([
        expect.objectContaining({ id: 'e1', bookedCount: 3 }),
        expect.objectContaining({ id: 'e2', bookedCount: 5 }),
      ]);
    });

    // final-review I1 — a published event that has STARTED but isn't
    // auto-completed yet (the scheduler only flips status at endAtLocal ??
    // start+180min) must still be findable — it belongs in `upcoming`, not
    // stuck between tabs for the hours until the next cron tick.
    it('upcoming: includes a published event whose start has already passed but is not yet completed', async () => {
      const events = [
        makeEvent({ id: 'e1', status: 'published', startAtLocal: '2020-01-01 10:00' }),
      ];
      eventsQb.getMany.mockResolvedValue(events);

      const result = await service.list(actor, { tab: 'upcoming' });

      expect(eventsQb.andWhere).toHaveBeenCalledWith(
        `(e.status = 'draft' OR e.status = 'published')`,
      );
      expect(result.data).toEqual([expect.objectContaining({ id: 'e1' })]);
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

  describe('assertPhotoEditable', () => {
    it.each(['draft', 'published'] as const)('allows photo changes on a %s event', (status) => {
      expect(() => service.assertPhotoEditable(makeEvent({ status }))).not.toThrow();
    });

    it.each(['completed', 'cancelled'] as const)(
      'rejects photo changes on a %s event with EVENT_NOT_SAFE_EDIT',
      (status) => {
        expect(() => service.assertPhotoEditable(makeEvent({ status }))).toThrow(
          expect.objectContaining({ response: expect.objectContaining({ code: 'EVENT_NOT_SAFE_EDIT' }) }),
        );
      },
    );
  });
});
