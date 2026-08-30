import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { Stay } from '../tenant-stays/stay.entity';
import { BookEventDto } from './dto/book-event.dto';
import { EventBooking } from './event-booking.entity';
import { Event } from './event.entity';
import { GuestEventsService } from './guest-events.service';

const HOTEL_ID = 'hotel-1';
const OTHER_HOTEL_ID = 'hotel-2';

const makeStay = (o: Record<string, unknown> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: HOTEL_ID,
    stayType: 'room_only',
    language: 'en',
    hotel: {
      id: HOTEL_ID,
      timezone: 'Africa/Cairo',
      currency: 'EGP',
      roomChargeEnabled: true,
    },
    ...o,
  }) as unknown as Stay;

const makeEvent = (o: Record<string, unknown> = {}) => ({
  id: 'event-1',
  hotelId: HOTEL_ID,
  titles: { ar: 'حفلة', en: 'Party' },
  descriptions: { ar: 'وصف', en: 'Description' },
  photoKeys: null,
  startAtLocal: '2030-06-01 18:00',
  endAtLocal: '2030-06-01 20:00',
  locationText: 'Pool deck',
  infoEntryId: null,
  capacity: 1,
  price: 100,
  includedFor: [],
  status: 'published',
  cancelReason: null,
  createdById: 'user-1',
  publishedAt: new Date(),
  cancelledAt: null,
  completedAt: null,
  cancelledById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const makeBooking = (o: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  hotelId: HOTEL_ID,
  eventId: 'event-1',
  stayId: 'stay-1',
  partySize: 1,
  snapshot: {
    titles: { ar: 'حفلة', en: 'Party' },
    startAtLocal: '2030-06-01 18:00',
    endAtLocal: '2030-06-01 20:00',
    locationText: 'Pool deck',
  },
  unitPrice: 100,
  included: false,
  totalAmount: 100,
  currency: 'EGP',
  paymentMethod: 'cash',
  status: 'booked',
  cancelledBy: null,
  cancelledAt: null,
  cancelledReason: null,
  settledAt: null,
  settledById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

describe('GuestEventsService (Story 21.4/21.5)', () => {
  let service: GuestEventsService;
  let eventsRepo: { findOne: jest.Mock; find: jest.Mock };
  let bookingsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let bookingsQb: Record<string, jest.Mock>;
  let access: { getAccessState: jest.Mock };
  let auditLogs: { log: jest.Mock };

  // Transaction manager wiring for book() — a shared, mutable "committed
  // rows" store so the SUM query genuinely reflects prior saves within the
  // test, the same "count reflects real state" discipline as the
  // tenant-rooms/tenant-staff seat-race tests (see managerBookingsSumQb).
  let committedBookings: Array<{ eventId: string; partySize: number; status: string }>;
  let managerEvents: { findOne: jest.Mock };
  let managerBookingsQb: Record<string, jest.Mock>;
  let managerBookings: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let manager: { getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    eventsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };

    bookingsQb = {};
    for (const m of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
      bookingsQb[m] = jest.fn().mockReturnValue(bookingsQb);
    }
    bookingsQb.getRawMany = jest.fn().mockResolvedValue([]);
    bookingsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (b) => b),
      createQueryBuilder: jest.fn(() => bookingsQb),
    };

    access = {
      getAccessState: jest.fn().mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['events'],
      }),
    };
    auditLogs = { log: jest.fn() };

    committedBookings = [];
    managerEvents = { findOne: jest.fn().mockResolvedValue(null) };
    managerBookingsQb = {};
    for (const m of ['select', 'addSelect', 'where', 'andWhere']) {
      managerBookingsQb[m] = jest.fn().mockReturnValue(managerBookingsQb);
    }
    managerBookingsQb.getRawOne = jest.fn(async () => {
      // Mirrors the real SQL: SUM(partySize) WHERE eventId = :id AND status
      // = 'booked' — computed live off whatever has actually been saved so
      // far, so two sequential book() calls in the same test genuinely see
      // each other's committed effect (the point of the race test below).
      const total = committedBookings
        .filter((b) => b.status === 'booked')
        .reduce((sum, b) => sum + b.partySize, 0);
      return { sum: String(total) };
    });
    managerBookings = {
      create: jest.fn((o) => ({ ...o })),
      save: jest.fn(async (row) => {
        const saved = { ...row, id: row.id ?? `booking-${committedBookings.length + 1}` };
        committedBookings.push({
          eventId: saved.eventId,
          partySize: saved.partySize,
          status: saved.status,
        });
        return saved;
      }),
      createQueryBuilder: jest.fn(() => managerBookingsQb),
    };
    manager = {
      getRepository: jest.fn((entity) =>
        entity === Event ? managerEvents : managerBookings,
      ),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestEventsService,
        { provide: getRepositoryToken(Event), useValue: eventsRepo },
        { provide: getRepositoryToken(EventBooking), useValue: bookingsRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: TenantAccessService, useValue: access },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(GuestEventsService);
  });

  // ------------------------------------------------------------------
  // Availability gating
  // ------------------------------------------------------------------

  describe('availability gating', () => {
    it('listUpcoming — suspended hotel → 403 HOTEL_UNAVAILABLE', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'suspended',
        readOnly: false,
        enabledModules: ['events'],
      });
      await expect(service.listUpcoming(makeStay())).rejects.toMatchObject({
        response: { code: 'HOTEL_UNAVAILABLE' },
      });
    });

    it('listUpcoming — events module not enabled → 403 MODULE_NOT_ENABLED', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: [],
      });
      await expect(service.listUpcoming(makeStay())).rejects.toMatchObject({
        response: { code: 'MODULE_NOT_ENABLED', module: 'events' },
      });
    });

    it('readOnly (expired trial) blocks book() too — a mutation must never slip through', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: true,
        enabledModules: ['events'],
      });
      await expect(
        service.book(makeStay(), 'event-1', { partySize: 1 } as BookEventDto),
      ).rejects.toMatchObject({ response: { code: 'HOTEL_UNAVAILABLE' } });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('cancelOwn never checks availability — always reachable, the F&B cancelOwn precedent', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'suspended',
        readOnly: true,
        enabledModules: [],
      });
      bookingsRepo.findOne.mockResolvedValue(
        makeBooking({ snapshot: { ...makeBooking().snapshot, startAtLocal: '2030-06-01 18:00' } }),
      );
      await expect(service.cancelOwn(makeStay(), 'booking-1')).resolves.toBeDefined();
      expect(access.getAccessState).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Browse
  // ------------------------------------------------------------------

  describe('listUpcoming', () => {
    it('scopes by hotelId + published + future startAtLocal, and batch-loads spots-left', async () => {
      const events = [makeEvent({ id: 'e1' }), makeEvent({ id: 'e2', capacity: null })];
      eventsRepo.find.mockResolvedValue(events);
      bookingsQb.getRawMany.mockResolvedValue([{ eventId: 'e1', total: '1' }]);

      const result = await service.listUpcoming(makeStay());

      expect(eventsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hotelId: HOTEL_ID, status: 'published' }),
        }),
      );
      expect(result.data).toHaveLength(2);
      const e1 = result.data.find((e) => e.id === 'e1')!;
      expect(e1.spotsLeft).toBe(0);
      expect(e1.soldOut).toBe(true);
      const e2 = result.data.find((e) => e.id === 'e2')!;
      expect(e2.spotsLeft).toBeNull();
      expect(e2.soldOut).toBe(false);
    });

    it('card price uses resolveEventPrice at partySize=1', async () => {
      eventsRepo.find.mockResolvedValue([makeEvent({ price: 50, includedFor: [] })]);
      const result = await service.listUpcoming(makeStay());
      expect(result.data[0].price).toEqual({ included: false, unitPrice: 50 });
    });

    it('fully-included event (stay type in includedFor) prices at 0', async () => {
      eventsRepo.find.mockResolvedValue([
        makeEvent({ price: 50, includedFor: ['room_only'] }),
      ]);
      const result = await service.listUpcoming(makeStay({ stayType: 'room_only' }));
      expect(result.data[0].price).toEqual({ included: true, unitPrice: 0 });
    });

    // final-review — defense behind the tenant-side safe-edit fix: if an
    // event ever ends up over-booked (a capacity edit slipping through, a
    // future import path), the guest must never see "-2 spots left".
    it('over-booked event: spotsLeft clamps to 0 and the card reads sold out', async () => {
      eventsRepo.find.mockResolvedValue([makeEvent({ id: 'e1', capacity: 2 })]);
      bookingsQb.getRawMany.mockResolvedValue([{ eventId: 'e1', total: '5' }]);

      const result = await service.listUpcoming(makeStay());

      expect(result.data[0].spotsLeft).toBe(0);
      expect(result.data[0].soldOut).toBe(true);
    });

    it('exactly-full event reads sold out, and a spot still free does not', async () => {
      eventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'full', capacity: 2 }),
        makeEvent({ id: 'open', capacity: 2 }),
      ]);
      bookingsQb.getRawMany.mockResolvedValue([
        { eventId: 'full', total: '2' },
        { eventId: 'open', total: '1' },
      ]);

      const result = await service.listUpcoming(makeStay());

      const full = result.data.find((e) => e.id === 'full')!;
      expect(full).toMatchObject({ spotsLeft: 0, soldOut: true });
      const open = result.data.find((e) => e.id === 'open')!;
      expect(open).toMatchObject({ spotsLeft: 1, soldOut: false });
    });

    it('no matching events never calls the batch booked-count query', async () => {
      eventsRepo.find.mockResolvedValue([]);
      await service.listUpcoming(makeStay());
      expect(bookingsRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getDetail', () => {
    it('returns the full view for a published event', async () => {
      eventsRepo.findOne.mockResolvedValue(makeEvent());
      const result = await service.getDetail(makeStay(), 'event-1');
      expect(result).toMatchObject({
        id: 'event-1',
        title: 'Party',
        description: 'Description',
        status: 'published',
        locationText: 'Pool deck',
      });
    });

    it('draft event → 404 EVENT_NOT_FOUND (guests never see drafts)', async () => {
      eventsRepo.findOne.mockResolvedValue(makeEvent({ status: 'draft' }));
      await expect(service.getDetail(makeStay(), 'event-1')).rejects.toMatchObject({
        response: { code: 'EVENT_NOT_FOUND' },
      });
    });

    it('completed/cancelled events remain visible (only draft is hidden)', async () => {
      eventsRepo.findOne.mockResolvedValue(makeEvent({ status: 'cancelled' }));
      await expect(service.getDetail(makeStay(), 'event-1')).resolves.toMatchObject({
        status: 'cancelled',
      });
    });

    // The start-time gate belongs to book() ONLY — a started event must stay
    // viewable so a deep link from the home strip / an announcement still
    // opens something (the booking CTA is what closes).
    it('a started but not-yet-completed event remains viewable', async () => {
      eventsRepo.findOne.mockResolvedValue(
        makeEvent({ startAtLocal: '2020-01-01 10:00', endAtLocal: '2020-01-01 12:00' }),
      );
      await expect(service.getDetail(makeStay(), 'event-1')).resolves.toMatchObject({
        id: 'event-1',
        status: 'published',
      });
    });

    it('cross-tenant/missing id → 404 EVENT_NOT_FOUND, scoped by hotelId', async () => {
      eventsRepo.findOne.mockResolvedValue(null);
      await expect(service.getDetail(makeStay(), 'event-x')).rejects.toMatchObject({
        response: { code: 'EVENT_NOT_FOUND' },
      });
      expect(eventsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'event-x', hotelId: HOTEL_ID },
      });
    });
  });

  // ------------------------------------------------------------------
  // book() — the capacity-race-safe write
  // ------------------------------------------------------------------

  describe('book', () => {
    const dto = (o: Partial<BookEventDto> = {}): BookEventDto =>
      ({ partySize: 1, ...o }) as BookEventDto;

    it('happy path — paid booking with cash, audits event_booking.created after commit', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ price: 100, includedFor: [] }));
      const callOrder: string[] = [];
      dataSource.transaction.mockImplementation(async (cb: (m: unknown) => unknown) => {
        const result = await cb(manager);
        callOrder.push('commit');
        return result;
      });
      auditLogs.log.mockImplementation(async () => {
        callOrder.push('audit');
      });

      const result = await service.book(makeStay(), 'event-1', dto({ paymentMethod: 'cash' }));

      expect(result).toMatchObject({
        eventId: 'event-1',
        partySize: 1,
        unitPrice: 100,
        included: false,
        totalAmount: 100,
        currency: 'EGP',
        paymentMethod: 'cash',
        status: 'booked',
      });
      expect(callOrder).toEqual(['commit', 'audit']);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'event_booking.created',
          entityType: 'event_booking',
          metadata: expect.objectContaining({ actorType: 'guest', hotelId: HOTEL_ID }),
        }),
      );
    });

    it('snapshots titles/schedule/location at booking time', async () => {
      managerEvents.findOne.mockResolvedValue(
        makeEvent({ titles: { ar: 'أ', en: 'A' }, startAtLocal: '2030-07-01 10:00' }),
      );
      const result = await service.book(makeStay(), 'event-1', dto({ paymentMethod: 'cash' }));
      expect(result.title).toBe('A');
      expect(result.startAtLocal).toBe('2030-07-01 10:00');
    });

    it('fully-included booking (stay type in includedFor) stores paymentMethod: null and skips the room-charge check entirely', async () => {
      managerEvents.findOne.mockResolvedValue(
        makeEvent({ price: 100, includedFor: ['room_only'] }),
      );
      const stay = makeStay({ stayType: 'room_only', hotel: { ...makeStay().hotel, roomChargeEnabled: false } });

      const result = await service.book(stay, 'event-1', dto());

      expect(result.included).toBe(true);
      expect(result.unitPrice).toBe(0);
      expect(result.totalAmount).toBe(0);
      expect(result.paymentMethod).toBeNull();
      expect(managerBookings.create).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethod: null, included: true }),
      );
    });

    it('room_charge requested but hotel.roomChargeEnabled === false → 400 EVENT_PAYMENT_METHOD_UNAVAILABLE', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ price: 100, includedFor: [] }));
      const stay = makeStay({ hotel: { ...makeStay().hotel, roomChargeEnabled: false } });

      await expect(
        service.book(stay, 'event-1', dto({ paymentMethod: 'room_charge' })),
      ).rejects.toMatchObject({ response: { code: 'EVENT_PAYMENT_METHOD_UNAVAILABLE' } });
      expect(managerBookings.save).not.toHaveBeenCalled();
    });

    it('room_charge requested and enabled → accepted', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ price: 100, includedFor: [] }));
      const result = await service.book(makeStay(), 'event-1', dto({ paymentMethod: 'room_charge' }));
      expect(result.paymentMethod).toBe('room_charge');
    });

    it('paid booking with no paymentMethod given defaults to cash', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ price: 100, includedFor: [] }));
      const result = await service.book(makeStay(), 'event-1', dto());
      expect(result.paymentMethod).toBe('cash');
    });

    it('event not published (draft) → 409 EVENT_NOT_BOOKABLE', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ status: 'draft' }));
      await expect(service.book(makeStay(), 'event-1', dto())).rejects.toMatchObject({
        response: { code: 'EVENT_NOT_BOOKABLE' },
      });
    });

    // final-review — booking closes at start, enforced server-side on the
    // HOTEL's clock. The client's guard runs on the device clock and is not
    // authoritative, and `status` alone can't cover this: the completion
    // tick only flips published → completed at endAtLocal (or start+3h), so
    // a started event stays `published` for hours. Winter date (repo TZ-test
    // convention): Africa/Cairo is a plain UTC+2 in January.
    describe('booking window (start-time gate)', () => {
      // 2030-01-15 18:00 hotel-local == 16:00Z.
      const started = () =>
        makeEvent({ startAtLocal: '2030-01-15 18:00', endAtLocal: '2030-01-15 20:00' });

      it('at exactly the start time → 409 EVENT_NOT_BOOKABLE, nothing written', async () => {
        managerEvents.findOne.mockResolvedValue(started());
        await expect(
          service.book(makeStay(), 'event-1', dto(), new Date('2030-01-15T16:00:00.000Z')),
        ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_BOOKABLE' } });
        expect(managerBookings.save).not.toHaveBeenCalled();
      });

      it('after the start but before the completion tick flips the status → 409 EVENT_NOT_BOOKABLE', async () => {
        managerEvents.findOne.mockResolvedValue(started());
        await expect(
          service.book(makeStay(), 'event-1', dto(), new Date('2030-01-15T16:30:00.000Z')),
        ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_BOOKABLE' } });
        expect(managerBookings.save).not.toHaveBeenCalled();
      });

      it('one minute before the start → still bookable', async () => {
        managerEvents.findOne.mockResolvedValue(started());
        await expect(
          service.book(makeStay(), 'event-1', dto(), new Date('2030-01-15T15:59:00.000Z')),
        ).resolves.toMatchObject({ status: 'booked' });
      });

      it('the gate is the HOTEL-local clock, not UTC (a Cairo event is still open at 17:30 local == 15:30Z)', async () => {
        managerEvents.findOne.mockResolvedValue(started());
        // 18:30Z would be past start if the server compared UTC stamps.
        await expect(
          service.book(makeStay(), 'event-1', dto(), new Date('2030-01-15T15:30:00.000Z')),
        ).resolves.toMatchObject({ status: 'booked' });
      });

      it('defaults `now` to the real clock when the caller passes none (the controller path)', async () => {
        jest.useFakeTimers({ now: new Date('2030-01-15T16:30:00.000Z').getTime() });
        managerEvents.findOne.mockResolvedValue(started());
        await expect(
          service.book(makeStay(), 'event-1', dto()),
        ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_BOOKABLE' } });
        jest.useRealTimers();
      });
    });

    it('cross-tenant event id → 404 EVENT_NOT_FOUND, scoped by hotelId in the SAME locked query (no wasted lock, no leak)', async () => {
      managerEvents.findOne.mockResolvedValue(null);
      await expect(
        service.book(makeStay({ hotelId: OTHER_HOTEL_ID }), 'event-1', dto()),
      ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_FOUND' } });
      expect(managerEvents.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-1', hotelId: OTHER_HOTEL_ID },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(managerBookings.createQueryBuilder).not.toHaveBeenCalled();
      expect(managerBookings.save).not.toHaveBeenCalled();
    });

    it('party size > 6 rejected even when capacity allows more (unlimited capacity)', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: null }));
      await expect(
        service.book(makeStay(), 'event-1', dto({ partySize: 7 })),
      ).rejects.toMatchObject({ response: { code: 'EVENT_PARTY_SIZE_INVALID' } });
      expect(managerBookings.save).not.toHaveBeenCalled();
    });

    it('party size < 1 rejected', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: null }));
      await expect(
        service.book(makeStay(), 'event-1', dto({ partySize: 0 })),
      ).rejects.toMatchObject({ response: { code: 'EVENT_PARTY_SIZE_INVALID' } });
    });

    it('party size > remaining capacity → 409 EVENT_SOLD_OUT', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: 3 }));
      committedBookings.push({ eventId: 'event-1', partySize: 2, status: 'booked' });
      await expect(
        service.book(makeStay(), 'event-1', dto({ partySize: 2 })),
      ).rejects.toMatchObject({
        response: { code: 'EVENT_SOLD_OUT', capacity: 3, used: 2, remaining: 1 },
      });
      expect(managerBookings.save).not.toHaveBeenCalled();
    });

    it('cancelled bookings never count against capacity', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: 1 }));
      committedBookings.push({ eventId: 'event-1', partySize: 1, status: 'cancelled' });
      await expect(service.book(makeStay(), 'event-1', dto({ partySize: 1 }))).resolves.toBeDefined();
    });

    it('unlimited capacity (null) never runs the SUM query', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: null }));
      await service.book(makeStay(), 'event-1', dto({ partySize: 5 }));
      expect(managerBookings.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('locks the event row BEFORE reading the capacity SUM (race guard — the pessimistic lock must be held before the count is read)', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: 5 }));
      const callOrder: string[] = [];
      managerEvents.findOne.mockImplementation(async (opts: Record<string, unknown>) => {
        if (opts?.lock) callOrder.push('lock');
        return makeEvent({ capacity: 5 });
      });
      managerBookingsQb.getRawOne = jest.fn(async () => {
        callOrder.push('sum');
        return { sum: '0' };
      });

      await service.book(makeStay(), 'event-1', dto());

      expect(callOrder).toEqual(['lock', 'sum']);
    });

    // The capacity-race-safety centerpiece: two "concurrent" requests for
    // the LAST spot. The mocked dataSource.transaction runs each callback
    // to completion before the next call starts (matching how a real
    // pessimistic_write lock serializes two transactions racing the SAME
    // row — the second transaction's SUM can only observe the first's
    // INSERT once the first has committed and released the lock), so
    // running the two book() calls back-to-back through the SAME
    // committedBookings store faithfully exercises the serialization the
    // real pessimistic lock provides.
    it('capacity race — two requests for the last spot: first succeeds, second gets 409 EVENT_SOLD_OUT, and the booked total never exceeds capacity', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: 1 }));

      const first = await service.book(makeStay(), 'event-1', dto({ partySize: 1 }));
      expect(first.status).toBe('booked');

      await expect(
        service.book(makeStay(), 'event-1', dto({ partySize: 1 })),
      ).rejects.toMatchObject({ response: { code: 'EVENT_SOLD_OUT' } });

      const totalBooked = committedBookings
        .filter((b) => b.status === 'booked')
        .reduce((sum, b) => sum + b.partySize, 0);
      expect(totalBooked).toBe(1);
    });

    it('capacity race — the last TWO spots, party sizes that would jointly overbook: first (size 2) succeeds, second (size 1) 409s', async () => {
      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: 2 }));

      await expect(
        service.book(makeStay(), 'event-1', dto({ partySize: 2 })),
      ).resolves.toMatchObject({ status: 'booked' });
      await expect(
        service.book(makeStay(), 'event-1', dto({ partySize: 1 })),
      ).rejects.toMatchObject({ response: { code: 'EVENT_SOLD_OUT' } });

      const totalBooked = committedBookings
        .filter((b) => b.status === 'booked')
        .reduce((sum, b) => sum + b.partySize, 0);
      expect(totalBooked).toBe(2);
    });

    // Deferred from Task 6 (tenant-events.service.spec.ts `cancel` describe
    // block): cancelling a published event cascades every `booked`
    // EventBooking to cancelled/staff, and a fresh book() attempt against
    // the now-cancelled event must 409 EVENT_NOT_BOOKABLE.
    it('Task 6 cross-task assertion — a fresh book() against a staff-cancelled event returns 409 EVENT_NOT_BOOKABLE', async () => {
      managerEvents.findOne.mockResolvedValue(
        makeEvent({ status: 'cancelled', cancelReason: 'Storm warning' }),
      );
      await expect(service.book(makeStay(), 'event-1', dto())).rejects.toMatchObject({
        response: { code: 'EVENT_NOT_BOOKABLE' },
      });
      expect(managerBookings.save).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // myBookings
  // ------------------------------------------------------------------

  describe('myBookings', () => {
    it('scopes to stay.id only', async () => {
      await service.myBookings(makeStay(), {});
      expect(bookingsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stayId: 'stay-1' } }),
      );
    });

    it('cancelled tab — a cancelled booking shows regardless of the linked event status/date', async () => {
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ status: 'cancelled', snapshot: { ...makeBooking().snapshot, startAtLocal: '2020-01-01 10:00' } }),
      ]);
      const result = await service.myBookings(makeStay(), { tab: 'cancelled' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe('cancelled');
    });

    it('upcoming tab — a booked booking whose event has not fully passed', async () => {
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ snapshot: { ...makeBooking().snapshot, startAtLocal: '2030-06-01 18:00', endAtLocal: '2030-06-01 20:00' } }),
      ]);
      const result = await service.myBookings(makeStay(), { tab: 'upcoming' });
      expect(result.data).toHaveLength(1);
    });

    it('past tab — a booked booking whose event has fully passed', async () => {
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ snapshot: { ...makeBooking().snapshot, startAtLocal: '2020-01-01 18:00', endAtLocal: '2020-01-01 20:00' } }),
      ]);
      const result = await service.myBookings(makeStay(), { tab: 'past' });
      expect(result.data).toHaveLength(1);
    });

    it('a past booked booking never shows in the upcoming tab, and vice versa', async () => {
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'past-1', snapshot: { ...makeBooking().snapshot, startAtLocal: '2020-01-01 18:00', endAtLocal: '2020-01-01 20:00' } }),
        makeBooking({ id: 'future-1', snapshot: { ...makeBooking().snapshot, startAtLocal: '2030-06-01 18:00', endAtLocal: '2030-06-01 20:00' } }),
      ]);
      const upcoming = await service.myBookings(makeStay(), { tab: 'upcoming' });
      expect(upcoming.data.map((b) => b.id)).toEqual(['future-1']);
      const past = await service.myBookings(makeStay(), { tab: 'past' });
      expect(past.data.map((b) => b.id)).toEqual(['past-1']);
    });

    it('a booking with no endAtLocal falls back to startAtLocal + 180 minutes for the past/upcoming boundary', async () => {
      // 2030-06-01 18:00 + 180min = 21:00. "Now" (real clock, far future
      // event) is before that boundary either way, so this only proves the
      // fallback path is taken without throwing on a null endAtLocal.
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ snapshot: { titles: { en: 'P' }, startAtLocal: '2030-06-01 18:00', endAtLocal: null, locationText: 'Deck' } }),
      ]);
      const result = await service.myBookings(makeStay(), { tab: 'upcoming' });
      expect(result.data).toHaveLength(1);
    });

    it('defaults to the upcoming tab when none is given', async () => {
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ snapshot: { ...makeBooking().snapshot, startAtLocal: '2030-06-01 18:00', endAtLocal: '2030-06-01 20:00' } }),
      ]);
      const result = await service.myBookings(makeStay(), {});
      expect(result.data).toHaveLength(1);
    });

    describe('todayBooking', () => {
      // Winter date (repo TZ-test convention, event-time.spec.ts /
      // guest-fe-test-clock-gotchas): Africa/Cairo is a plain UTC+2 in
      // January, no DST ambiguity. 15:00Z -> 17:00 hotel-local.
      const NOW = new Date('2030-01-15T15:00:00.000Z');

      beforeEach(() => {
        jest.useFakeTimers({ now: NOW.getTime() });
      });
      afterEach(() => {
        jest.useRealTimers();
      });

      it('a booked booking starting today, not yet fully passed → todayBooking', async () => {
        bookingsRepo.find.mockResolvedValue([
          makeBooking({
            snapshot: { titles: { en: 'P' }, startAtLocal: '2030-01-15 18:00', endAtLocal: '2030-01-15 20:00', locationText: 'Deck' },
          }),
        ]);
        const result = await service.myBookings(makeStay(), {});
        expect(result.todayBooking?.id).toBe('booking-1');
      });

      it('a booked booking today but already past its end time → not todayBooking', async () => {
        bookingsRepo.find.mockResolvedValue([
          makeBooking({
            snapshot: { titles: { en: 'P' }, startAtLocal: '2030-01-15 10:00', endAtLocal: '2030-01-15 12:00', locationText: 'Deck' },
          }),
        ]);
        const result = await service.myBookings(makeStay(), {});
        expect(result.todayBooking).toBeNull();
      });

      it('a booked booking on a different day → not todayBooking', async () => {
        bookingsRepo.find.mockResolvedValue([
          makeBooking({
            snapshot: { titles: { en: 'P' }, startAtLocal: '2030-01-16 18:00', endAtLocal: '2030-01-16 20:00', locationText: 'Deck' },
          }),
        ]);
        const result = await service.myBookings(makeStay(), {});
        expect(result.todayBooking).toBeNull();
      });

      // final-review — the strip announces what's happening NEXT today. The
      // list arrives createdAt DESC, so `find()` picked the most recently
      // BOOKED event; it must pick the earliest-STARTING one instead.
      it('two bookings today → the earliest-starting one wins, not the most recently created', async () => {
        bookingsRepo.find.mockResolvedValue([
          // createdAt DESC order, as the repo returns it: booked today...
          makeBooking({
            id: 'booked-today-evening',
            createdAt: new Date('2030-01-15T09:00:00.000Z'),
            snapshot: { titles: { en: 'Dinner' }, startAtLocal: '2030-01-15 20:00', endAtLocal: '2030-01-15 22:00', locationText: 'Deck' },
          }),
          // ...and booked last week, but it starts first today.
          makeBooking({
            id: 'booked-last-week-morning',
            createdAt: new Date('2030-01-08T09:00:00.000Z'),
            snapshot: { titles: { en: 'Yoga' }, startAtLocal: '2030-01-15 09:00', endAtLocal: '2030-01-15 23:00', locationText: 'Beach' },
          }),
        ]);
        const result = await service.myBookings(makeStay(), {});
        expect(result.todayBooking?.id).toBe('booked-last-week-morning');
      });

      it('the earliest-starting booking that has already finished is skipped for the next one', async () => {
        bookingsRepo.find.mockResolvedValue([
          makeBooking({
            id: 'evening',
            snapshot: { titles: { en: 'Dinner' }, startAtLocal: '2030-01-15 20:00', endAtLocal: '2030-01-15 22:00', locationText: 'Deck' },
          }),
          makeBooking({
            id: 'morning-done',
            snapshot: { titles: { en: 'Yoga' }, startAtLocal: '2030-01-15 09:00', endAtLocal: '2030-01-15 10:00', locationText: 'Beach' },
          }),
        ]);
        const result = await service.myBookings(makeStay(), {});
        expect(result.todayBooking?.id).toBe('evening');
      });

      it('a cancelled booking today is never todayBooking', async () => {
        bookingsRepo.find.mockResolvedValue([
          makeBooking({
            status: 'cancelled',
            snapshot: { titles: { en: 'P' }, startAtLocal: '2030-01-15 18:00', endAtLocal: '2030-01-15 20:00', locationText: 'Deck' },
          }),
        ]);
        const result = await service.myBookings(makeStay(), {});
        expect(result.todayBooking).toBeNull();
      });
    });
  });

  // ------------------------------------------------------------------
  // cancelOwn — lock-free monotonic release
  // ------------------------------------------------------------------

  describe('cancelOwn', () => {
    it('pre-start cancel succeeds, is lock-free (no transaction), flips status/cancelledBy/cancelledAt', async () => {
      bookingsRepo.findOne.mockResolvedValue(
        makeBooking({ snapshot: { ...makeBooking().snapshot, startAtLocal: '2030-06-01 18:00' } }),
      );
      const result = await service.cancelOwn(makeStay(), 'booking-1');

      expect(result.status).toBe('cancelled');
      expect(result.cancelledBy).toBe('guest');
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(bookingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled', cancelledBy: 'guest' }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'event_booking.cancelled' }),
      );
    });

    it('releases capacity — a subsequent book() against the freed spot succeeds', async () => {
      // Fill the only spot directly against the shared committedBookings
      // store (the same one book() reads from), so the "release" is
      // observable the same way the race test observes a "take".
      committedBookings.push({ eventId: 'event-1', partySize: 1, status: 'booked' });
      bookingsRepo.findOne.mockResolvedValue(
        makeBooking({ id: 'booking-1', eventId: 'event-1', snapshot: { ...makeBooking().snapshot, startAtLocal: '2030-06-01 18:00' } }),
      );
      bookingsRepo.save.mockImplementation(async (b) => {
        // Guest-cancel flips the SAME row the SUM query is watching.
        const row = committedBookings.find((c) => c.eventId === b.eventId);
        if (row) row.status = 'cancelled';
        return b;
      });

      await service.cancelOwn(makeStay(), 'booking-1');

      managerEvents.findOne.mockResolvedValue(makeEvent({ capacity: 1 }));
      await expect(
        service.book(makeStay(), 'event-1', { partySize: 1 } as BookEventDto),
      ).resolves.toMatchObject({ status: 'booked' });
    });

    it('post-start cancel → 409 EVENT_BOOKING_PAST_START', async () => {
      bookingsRepo.findOne.mockResolvedValue(
        makeBooking({ snapshot: { ...makeBooking().snapshot, startAtLocal: '2020-01-01 10:00' } }),
      );
      await expect(service.cancelOwn(makeStay(), 'booking-1')).rejects.toMatchObject({
        response: { code: 'EVENT_BOOKING_PAST_START' },
      });
      expect(bookingsRepo.save).not.toHaveBeenCalled();
    });

    it('already-cancelled booking → 409 EVENT_BOOKING_INVALID_STATUS', async () => {
      bookingsRepo.findOne.mockResolvedValue(makeBooking({ status: 'cancelled' }));
      await expect(service.cancelOwn(makeStay(), 'booking-1')).rejects.toMatchObject({
        response: { code: 'EVENT_BOOKING_INVALID_STATUS' },
      });
    });

    it('cross-tenant/missing booking id → 404 EVENT_BOOKING_NOT_FOUND, scoped by stayId', async () => {
      bookingsRepo.findOne.mockResolvedValue(null);
      await expect(service.cancelOwn(makeStay(), 'booking-x')).rejects.toMatchObject({
        response: { code: 'EVENT_BOOKING_NOT_FOUND' },
      });
      expect(bookingsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'booking-x', stayId: 'stay-1' },
      });
    });
  });
});
