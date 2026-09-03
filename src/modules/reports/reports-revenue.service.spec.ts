import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Between } from 'typeorm';
import { EventBooking } from '../events/event-booking.entity';
import { Event } from '../events/event.entity';
import { EventSettlementSource } from '../events/event-settlement-source';
import { FnbOrderLine } from '../fnb/fnb-order-line.entity';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { FnbSettlementSource } from '../fnb/fnb-settlement-source';
import { Hotel } from '../hotels/hotel.entity';
import { ReportsRevenueService } from './reports-revenue.service';
import { resolvePeriod } from './reports-period';

const HOTEL_ID = 'hotel-1';
const TZ = 'Africa/Cairo'; // UTC+2 in January — no DST, keeps arithmetic simple.

const makeHotel = (o: Partial<Hotel> = {}): Hotel =>
  ({
    id: HOTEL_ID,
    timezone: TZ,
    currency: 'EGP',
    ...o,
  }) as Hotel;

const makeOrder = (o: Partial<FnbOrder> = {}): FnbOrder =>
  ({
    id: 'order-1',
    hotelId: HOTEL_ID,
    status: 'delivered',
    totalAmount: 100,
    destinationType: 'room',
    locationId: null,
    locationKey: null,
    locationNames: null,
    paymentMethod: 'cash',
    deliveredAt: new Date('2026-01-10T10:00:00Z'),
    cancelledAt: null,
    cancelledReason: null,
    settledAt: null,
    createdAt: new Date('2026-01-10T09:00:00Z'),
    ...o,
  }) as FnbOrder;

const makeLine = (o: Partial<FnbOrderLine> = {}): FnbOrderLine =>
  ({
    id: 'line-1',
    orderId: 'order-1',
    itemId: 'item-1',
    itemNames: { en: 'Burger', ar: 'برجر' },
    quantity: 1,
    unitPrice: 100,
    included: false,
    lineTotal: 100,
    ...o,
  }) as FnbOrderLine;

const makeEvent = (o: Partial<Event> = {}): Event =>
  ({
    id: 'event-1',
    hotelId: HOTEL_ID,
    titles: { en: 'Wine Tasting', ar: 'تذوق النبيذ' },
    startAtLocal: '2026-01-11 18:00',
    capacity: 20,
    status: 'published',
    ...o,
  }) as Event;

const makeBooking = (o: Partial<EventBooking> = {}): EventBooking =>
  ({
    id: 'booking-1',
    eventId: 'event-1',
    hotelId: HOTEL_ID,
    stayId: 'stay-1',
    partySize: 2,
    unitPrice: 50,
    included: false,
    totalAmount: 100,
    paymentMethod: 'cash',
    status: 'booked',
    settledAt: null,
    createdAt: new Date('2026-01-05T09:00:00Z'), // deliberately outside dining/events windows below
    ...o,
  }) as EventBooking;

describe('ReportsRevenueService (Story 22.3)', () => {
  let service: ReportsRevenueService;
  let hotelsRepo: { findOne: jest.Mock };
  let ordersRepo: { find: jest.Mock };
  let linesRepo: { find: jest.Mock };
  let eventsRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let eventsQb: Record<string, jest.Mock>;
  let bookingsRepo: { find: jest.Mock };
  let fnbSettlement: { findUnsettledByStay: jest.Mock };
  let eventSettlement: { findUnsettledByStay: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(makeHotel()) };
    ordersRepo = { find: jest.fn().mockResolvedValue([]) };
    linesRepo = { find: jest.fn().mockResolvedValue([]) };
    // Epic 22 final review, I4 — fetchPeriodEvents() now pushes the
    // startAtLocal range (and status) into the query via
    // createQueryBuilder() instead of eventsRepo.find() + in-memory
    // filtering (which defeated IDX_events_hotel_start).
    eventsQb = {
      where: jest.fn(),
      andWhere: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    eventsQb.where.mockReturnValue(eventsQb);
    eventsQb.andWhere.mockReturnValue(eventsQb);
    eventsRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => eventsQb),
    };
    bookingsRepo = { find: jest.fn().mockResolvedValue([]) };
    fnbSettlement = { findUnsettledByStay: jest.fn().mockResolvedValue(new Map()) };
    eventSettlement = { findUnsettledByStay: jest.fn().mockResolvedValue(new Map()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsRevenueService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(FnbOrder), useValue: ordersRepo },
        { provide: getRepositoryToken(FnbOrderLine), useValue: linesRepo },
        { provide: getRepositoryToken(Event), useValue: eventsRepo },
        { provide: getRepositoryToken(EventBooking), useValue: bookingsRepo },
        { provide: FnbSettlementSource, useValue: fnbSettlement },
        { provide: EventSettlementSource, useValue: eventSettlement },
      ],
    }).compile();
    service = moduleRef.get(ReportsRevenueService);
  });

  // ==================================================================
  // dining
  // ==================================================================
  describe('dining', () => {
    const dto = { preset: 'custom', from: '2026-01-10', to: '2026-01-12' } as any;
    const now = new Date('2026-01-15T10:00:00Z');
    const resolved = resolvePeriod(TZ, now, dto);

    it('1. queries delivered orders by deliveredAt Between [fromUtc, toUtcExclusive), NOT createdAt', async () => {
      await service.dining(HOTEL_ID, dto, now);

      const callArg = ordersRepo.find.mock.calls[0][0];
      expect(callArg.where).toEqual({
        hotelId: HOTEL_ID,
        status: 'delivered',
        deliveredAt: Between(resolved.fromUtc, resolved.toUtcExclusive),
      });
      // Explicitly proves createdAt is never used as the basis filter.
      expect(callArg.where.createdAt).toBeUndefined();
    });

    it('2. queries cancelled orders by cancelledAt Between [fromUtc, toUtcExclusive), NOT createdAt', async () => {
      await service.dining(HOTEL_ID, dto, now);

      const callArg = ordersRepo.find.mock.calls[1][0];
      expect(callArg.where).toEqual({
        hotelId: HOTEL_ID,
        status: 'cancelled',
        cancelledAt: Between(resolved.fromUtc, resolved.toUtcExclusive),
      });
      expect(callArg.where.createdAt).toBeUndefined();
    });

    it('3. revenueByDay groups by hotel-local day and rounds cleanly despite floating-point-prone sums', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([
              makeOrder({ id: 'o1', totalAmount: 0.1, deliveredAt: new Date('2026-01-10T10:00:00Z') }),
              makeOrder({ id: 'o2', totalAmount: 0.2, deliveredAt: new Date('2026-01-10T12:00:00Z') }),
              makeOrder({ id: 'o3', totalAmount: 50, deliveredAt: new Date('2026-01-11T10:00:00Z') }),
            ])
          : Promise.resolve([]),
      );

      const res = await service.dining(HOTEL_ID, dto, now);

      expect(res.revenueByDay).toEqual([
        { date: '2026-01-10', revenue: 0.3, orders: 2 },
        { date: '2026-01-11', revenue: 50, orders: 1 },
      ]);
    });

    it('4. ordersCount and revenueTotal reflect the delivered set', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([makeOrder({ id: 'o1', totalAmount: 30 }), makeOrder({ id: 'o2', totalAmount: 20 })])
          : Promise.resolve([]),
      );

      const res = await service.dining(HOTEL_ID, dto, now);

      expect(res.ordersCount).toBe(2);
      expect(res.revenueTotal).toBe(50);
    });

    it('5. avgOrderValue excludes zero-totalAmount (fully-included) orders from both numerator and denominator', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([
              makeOrder({ id: 'o1', totalAmount: 100 }),
              makeOrder({ id: 'o2', totalAmount: 0 }), // fully included
              makeOrder({ id: 'o3', totalAmount: 50 }),
            ])
          : Promise.resolve([]),
      );

      const res = await service.dining(HOTEL_ID, dto, now);

      // revenueTotal = 150 (includes the 0), but avg divides by 2 paid orders only.
      expect(res.revenueTotal).toBe(150);
      expect(res.avgOrderValue).toBe(75);
    });

    it('6. avgOrderValue is null when zero paid orders exist even though ordersCount > 0', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([makeOrder({ id: 'o1', totalAmount: 0 }), makeOrder({ id: 'o2', totalAmount: 0 })])
          : Promise.resolve([]),
      );

      const res = await service.dining(HOTEL_ID, dto, now);

      expect(res.ordersCount).toBe(2);
      expect(res.avgOrderValue).toBeNull();
    });

    it('7. topItems vs includedConsumption split by the line\'s included flag; consumption never carries a revenue key or lineTotal', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered' ? Promise.resolve([makeOrder({ id: 'o1' })]) : Promise.resolve([]),
      );
      linesRepo.find.mockResolvedValue([
        makeLine({ id: 'l1', itemId: 'paid-item', included: false, quantity: 2, lineTotal: 40 }),
        makeLine({ id: 'l2', itemId: 'included-item', included: true, quantity: 3, lineTotal: 999 }), // lineTotal must never surface
      ]);

      const res = await service.dining(HOTEL_ID, dto, now);

      expect(res.topItems).toEqual([{ itemId: 'paid-item', names: { en: 'Burger', ar: 'برجر' }, qty: 2, revenue: 40 }]);
      expect(res.includedConsumption).toEqual([{ itemId: 'included-item', names: { en: 'Burger', ar: 'برجر' }, qty: 3 }]);
      // Shape check: no 'revenue' key anywhere in includedConsumption.
      expect(Object.keys(res.includedConsumption[0])).not.toContain('revenue');
      // The included line's 999 lineTotal never appears in topItems' revenue figures.
      expect(res.topItems.some((t) => t.revenue === 999)).toBe(false);
    });

    it('8. byZone groups room vs named locations correctly, carrying locationNames only for location destinations', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([
              makeOrder({ id: 'o1', destinationType: 'room', totalAmount: 40 }),
              makeOrder({ id: 'o2', destinationType: 'room', totalAmount: 10 }),
              makeOrder({
                id: 'o3',
                destinationType: 'location',
                locationKey: 'pool',
                locationNames: { en: 'Pool Bar', ar: 'بار المسبح' },
                totalAmount: 60,
              }),
            ])
          : Promise.resolve([]),
      );

      const res = await service.dining(HOTEL_ID, dto, now);

      expect(res.byZone).toEqual(
        expect.arrayContaining([
          { destinationType: 'room', locationKey: null, names: null, revenue: 50, orders: 2 },
          {
            destinationType: 'location',
            locationKey: 'pool',
            names: { en: 'Pool Bar', ar: 'بار المسبح' },
            revenue: 60,
            orders: 1,
          },
        ]),
      );
      expect(res.byZone).toHaveLength(2);
    });

    it('9. paymentSplit sums cash/roomCharge from delivered orders only', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([
              makeOrder({ id: 'o1', paymentMethod: 'cash', totalAmount: 30 }),
              makeOrder({ id: 'o2', paymentMethod: 'room_charge', totalAmount: 70 }),
            ])
          : Promise.resolve([]),
      );

      const res = await service.dining(HOTEL_ID, dto, now);

      expect(res.paymentSplit).toEqual({ cash: 30, roomCharge: 70 });
    });

    it("10. cancellations uses cancelledAt as its period anchor — a cancelled order's createdAt outside the period doesn't matter, cancelledAt inside does", async () => {
      // Since the mocked repo doesn't itself filter, the correctness proof is
      // twofold: (a) the query passed to the repo filters on cancelledAt (test
      // 2 above), and (b) the aggregation correctly counts whatever the
      // cancelled-fetch returns regardless of createdAt.
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'cancelled'
          ? Promise.resolve([
              makeOrder({
                id: 'o-cancelled',
                status: 'cancelled',
                createdAt: new Date('2020-01-01T00:00:00Z'), // far outside the period
                cancelledAt: new Date('2026-01-11T10:00:00Z'), // inside the period
                cancelledReason: 'out_of_stock',
              }),
            ])
          : Promise.resolve([]),
      );

      const res = await service.dining(HOTEL_ID, dto, now);

      expect(res.cancellations).toEqual({ count: 1, reasons: [{ reason: 'out_of_stock', count: 1 }] });
    });

    it('11. basis is delivered_only and period reflects the resolved range', async () => {
      const res = await service.dining(HOTEL_ID, dto, now);
      expect(res.basis).toBe('delivered_only');
      expect(res.period).toEqual({ preset: 'custom', from: '2026-01-10', to: '2026-01-12', days: 3 });
      expect(res.currency).toBe('EGP');
    });

    it('12. maps a ReportPeriodError to BadRequestException with code REPORT_RANGE_INVALID', async () => {
      await expect(service.dining(HOTEL_ID, { preset: 'custom' } as any, now)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      try {
        await service.dining(HOTEL_ID, { preset: 'custom' } as any, now);
        fail('expected dining() to throw');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({ code: 'REPORT_RANGE_INVALID' }),
        );
      }
    });
  });

  // ==================================================================
  // events
  // ==================================================================
  describe('events', () => {
    const dto = { preset: 'custom', from: '2026-01-10', to: '2026-01-12' } as any;
    const now = new Date('2026-01-15T10:00:00Z');

    // Epic 22 final review, I4 — fetchPeriodEvents() now pushes hotelId,
    // status, AND the startAtLocal range into the query itself
    // (createQueryBuilder), instead of fetching every published/completed
    // event for the hotel and filtering the range in memory (which defeated
    // IDX_events_hotel_start). A mocked query builder can't exercise real
    // SQL boundary semantics, so these tests assert the exact predicate/
    // param values reach the query builder, rather than asserting on
    // filtered-vs-unfiltered fixture rows.
    it('1. queries events by hotelId + status in [published, completed] via the query builder', async () => {
      await service.events(HOTEL_ID, dto, now);

      expect(eventsRepo.createQueryBuilder).toHaveBeenCalledWith('e');
      expect(eventsQb.where).toHaveBeenCalledWith('e.hotelId = :hotelId', { hotelId: HOTEL_ID });
      expect(eventsQb.andWhere).toHaveBeenCalledWith('e.status IN (:...statuses)', {
        statuses: ['published', 'completed'],
      });
    });

    it('2. passes the lower boundary (fromDate 00:00) as the exact :from param', async () => {
      await service.events(HOTEL_ID, dto, now);

      expect(eventsQb.andWhere).toHaveBeenCalledWith(
        'e.startAtLocal >= :from AND e.startAtLocal <= :to',
        { from: '2026-01-10 00:00', to: '2026-01-12 23:59' },
      );
    });

    it('3. passes the upper boundary (toDate 23:59) as the exact :to param for a different resolved range', async () => {
      const narrowDto = { preset: 'custom', from: '2026-01-02', to: '2026-01-05' } as any;

      await service.events(HOTEL_ID, narrowDto, now);

      expect(eventsQb.andWhere).toHaveBeenCalledWith(
        'e.startAtLocal >= :from AND e.startAtLocal <= :to',
        { from: '2026-01-02 00:00', to: '2026-01-05 23:59' },
      );
    });

    it('4. events() returns exactly what the query builder resolves — no additional in-memory startAtLocal filtering on top', async () => {
      eventsQb.getMany.mockResolvedValue([
        makeEvent({ id: 'e-outside-if-app-filtered', startAtLocal: '2099-01-01 00:00' }),
      ]);

      const res = await service.events(HOTEL_ID, dto, now);

      // The service trusts the query's own filtering entirely; it must not
      // re-check/re-exclude rows the (mocked) query already returned.
      expect(res.events.map((e) => e.eventId)).toEqual(['e-outside-if-app-filtered']);
    });

    it('4b. Epic 22 final review, I4 — the bookings fetch carries an explicit hotelId predicate alongside eventId In(...)', async () => {
      eventsQb.getMany.mockResolvedValue([makeEvent({ id: 'e1' })]);

      await service.events(HOTEL_ID, dto, now);

      const callArg = bookingsRepo.find.mock.calls[0][0];
      expect(callArg.where.hotelId).toBe(HOTEL_ID);
      expect(callArg.where.eventId).toBeDefined();
    });

    it('5. a draft-status event is excluded entirely even if its startAtLocal is in range (the repo query itself filters status, proven by test 1); a cancelled event likewise never reaches the candidates list', async () => {
      // eventsRepo.find is mocked to represent what the DB would return for
      // the where clause asserted in test 1 (status IN [published, completed]).
      // Simulate the DB correctly excluding draft/cancelled by simply not
      // returning them, proving the aggregation doesn't need to re-filter.
      eventsQb.getMany.mockResolvedValue([makeEvent({ id: 'e-published', status: 'published' })]);

      const res = await service.events(HOTEL_ID, dto, now);

      expect(res.events.map((e) => e.eventId)).toEqual(['e-published']);
    });

    it('6. booked sums partySize of status=booked bookings only', async () => {
      eventsQb.getMany.mockResolvedValue([makeEvent()]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b1', status: 'booked', partySize: 2 }),
        makeBooking({ id: 'b2', status: 'booked', partySize: 3 }),
        makeBooking({ id: 'b3', status: 'cancelled', partySize: 10 }),
      ]);

      const res = await service.events(HOTEL_ID, dto, now);

      expect(res.events[0].booked).toBe(5);
    });

    it('7. revenue excludes included bookings', async () => {
      eventsQb.getMany.mockResolvedValue([makeEvent()]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b1', status: 'booked', included: false, totalAmount: 100 }),
        makeBooking({ id: 'b2', status: 'booked', included: true, totalAmount: 999, unitPrice: 0 }),
      ]);

      const res = await service.events(HOTEL_ID, dto, now);

      expect(res.events[0].revenue).toBe(100);
    });

    it('8. paidSeats/freeSeats/includedSeats partition a 3-way split correctly (unitPrice 0 + included:false is freeSeats, not paidSeats or includedSeats)', async () => {
      eventsQb.getMany.mockResolvedValue([makeEvent()]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b-paid', status: 'booked', included: false, unitPrice: 50, partySize: 1 }),
        makeBooking({ id: 'b-free', status: 'booked', included: false, unitPrice: 0, totalAmount: 0, partySize: 2 }),
        makeBooking({ id: 'b-included', status: 'booked', included: true, unitPrice: 0, totalAmount: 0, partySize: 3 }),
      ]);

      const res = await service.events(HOTEL_ID, dto, now);

      expect(res.events[0].paidSeats).toBe(1);
      expect(res.events[0].freeSeats).toBe(2);
      expect(res.events[0].includedSeats).toBe(3);
    });

    it('9. cancellationRatePct is a ratio over ALL bookings (booked + cancelled), not just active ones', async () => {
      eventsQb.getMany.mockResolvedValue([makeEvent()]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b1', status: 'booked' }),
        makeBooking({ id: 'b2', status: 'cancelled' }),
        makeBooking({ id: 'b3', status: 'cancelled' }),
        makeBooking({ id: 'b4', status: 'cancelled' }),
      ]);

      const res = await service.events(HOTEL_ID, dto, now);

      expect(res.events[0].cancellationRatePct).toBe(75);
    });

    it("10. a booking's createdAt far outside the period doesn't matter — only the event's startAtLocal gates inclusion", async () => {
      eventsQb.getMany.mockResolvedValue([makeEvent({ startAtLocal: '2026-01-11 18:00' })]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b1', status: 'booked', partySize: 4, createdAt: new Date('2019-06-01T00:00:00Z') }),
      ]);

      const res = await service.events(HOTEL_ID, dto, now);

      expect(res.events[0].booked).toBe(4);
    });

    it('11. totals aggregate revenue/booked/cancellationRatePct across all in-period events', async () => {
      eventsQb.getMany.mockResolvedValue([
        makeEvent({ id: 'e1', startAtLocal: '2026-01-10 10:00' }),
        makeEvent({ id: 'e2', startAtLocal: '2026-01-11 10:00' }),
      ]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b1', eventId: 'e1', status: 'booked', partySize: 2, totalAmount: 50 }),
        makeBooking({ id: 'b2', eventId: 'e2', status: 'booked', partySize: 3, totalAmount: 30 }),
        makeBooking({ id: 'b3', eventId: 'e2', status: 'cancelled', partySize: 1 }),
      ]);

      const res = await service.events(HOTEL_ID, dto, now);

      expect(res.totals.revenue).toBe(80);
      expect(res.totals.booked).toBe(5);
      expect(res.totals.cancellationRatePct).toBe(round(1 / 3));
    });

    it('12. maps a ReportPeriodError to BadRequestException', async () => {
      await expect(service.events(HOTEL_ID, { preset: 'custom' } as any, now)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    function round(fraction: number): number {
      return Math.round(fraction * 100 * 100) / 100;
    }
  });

  // ==================================================================
  // totals
  // ==================================================================
  describe('totals', () => {
    const dto = { preset: 'custom', from: '2026-01-10', to: '2026-01-12' } as any;
    const now = new Date('2026-01-15T10:00:00Z');
    const resolved = resolvePeriod(TZ, now, dto);

    it('1. grandTotal = dining revenue + events revenue, parity-checked against independently-called dining()/events()', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([makeOrder({ id: 'o1', totalAmount: 40 }), makeOrder({ id: 'o2', totalAmount: 60 })])
          : Promise.resolve([]),
      );
      eventsQb.getMany.mockResolvedValue([makeEvent({ startAtLocal: '2026-01-11 10:00' })]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b1', status: 'booked', included: false, totalAmount: 30 }),
      ]);

      const [diningRes, eventsRes, totalsRes] = await Promise.all([
        service.dining(HOTEL_ID, dto, now),
        service.events(HOTEL_ID, dto, now),
        service.totals(HOTEL_ID, dto, now),
      ]);

      expect(totalsRes.grandTotal).toBe(round2(diningRes.revenueTotal + eventsRes.totals.revenue));
      expect(totalsRes.grandTotal).toBe(130);
    });

    it('2. collected sums cash (unconditional) + room-charge WHERE settledAt is set, across dining and events', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([
              makeOrder({ id: 'o-cash', paymentMethod: 'cash', totalAmount: 20 }),
              makeOrder({ id: 'o-rc-settled', paymentMethod: 'room_charge', totalAmount: 30, settledAt: new Date() }),
              makeOrder({ id: 'o-rc-unsettled', paymentMethod: 'room_charge', totalAmount: 40, settledAt: null }),
            ])
          : Promise.resolve([]),
      );
      eventsQb.getMany.mockResolvedValue([makeEvent({ startAtLocal: '2026-01-11 10:00' })]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b-cash', status: 'booked', paymentMethod: 'cash', totalAmount: 10 }),
        makeBooking({ id: 'b-rc-settled', status: 'booked', paymentMethod: 'room_charge', totalAmount: 15, settledAt: new Date() }),
        makeBooking({ id: 'b-rc-unsettled', status: 'booked', paymentMethod: 'room_charge', totalAmount: 25, settledAt: null }),
      ]);

      const res = await service.totals(HOTEL_ID, dto, now);

      // 20 (cash) + 30 (settled rc) + 10 (cash) + 15 (settled rc) = 75
      expect(res.collected).toBe(75);
    });

    it('3. outstanding calls fnbSettlement/eventSettlement.findUnsettledByStay with hotelId', async () => {
      await service.totals(HOTEL_ID, dto, now);

      expect(fnbSettlement.findUnsettledByStay).toHaveBeenCalledWith(HOTEL_ID);
      expect(eventSettlement.findUnsettledByStay).toHaveBeenCalledWith(HOTEL_ID);
    });

    it('4. outstanding sums only unsettled lines whose createdAt falls in the period — a line with createdAt OUTSIDE the period is excluded even though it is currently unsettled', async () => {
      fnbSettlement.findUnsettledByStay.mockResolvedValue(
        new Map([
          [
            'stay-1',
            [
              { id: 'u1', totalAmount: 50, createdAt: new Date('2026-01-11T10:00:00Z') }, // inside
              { id: 'u2', totalAmount: 999, createdAt: new Date('2020-01-01T00:00:00Z') }, // outside — must be excluded
            ],
          ],
        ]),
      );

      const res = await service.totals(HOTEL_ID, dto, now);

      expect(res.outstanding).toBe(50);
    });

    it('5. outstanding sums fnb + event unsettled lines together', async () => {
      fnbSettlement.findUnsettledByStay.mockResolvedValue(
        new Map([['stay-1', [{ id: 'u1', totalAmount: 30, createdAt: new Date('2026-01-11T10:00:00Z') }]]]),
      );
      eventSettlement.findUnsettledByStay.mockResolvedValue(
        new Map([['stay-2', [{ id: 'u2', totalAmount: 20, createdAt: new Date('2026-01-11T12:00:00Z') }]]]),
      );

      const res = await service.totals(HOTEL_ID, dto, now);

      expect(res.outstanding).toBe(50);
    });

    it('6. collected + outstanding equals grandTotal exactly when every room-charge row is accounted for by either settledAt OR the mocked unsettled map (complete, non-overlapping partition)', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([
              makeOrder({ id: 'o-cash', paymentMethod: 'cash', totalAmount: 20 }),
              makeOrder({
                id: 'o-rc-settled',
                paymentMethod: 'room_charge',
                totalAmount: 30,
                settledAt: new Date(),
                stayId: 'stay-settled',
              }),
              makeOrder({
                id: 'o-rc-unsettled',
                paymentMethod: 'room_charge',
                totalAmount: 40,
                settledAt: null,
                stayId: 'stay-unsettled',
                createdAt: new Date('2026-01-10T09:00:00Z'),
              }),
            ])
          : Promise.resolve([]),
      );
      // The unsettled room-charge order above is exactly the one line the mock
      // returns as still-unsettled, with a createdAt inside the period.
      fnbSettlement.findUnsettledByStay.mockResolvedValue(
        new Map([['stay-unsettled', [{ id: 'o-rc-unsettled', totalAmount: 40, createdAt: new Date('2026-01-10T09:00:00Z') }]]]),
      );

      const res = await service.totals(HOTEL_ID, dto, now);

      // grandTotal = 20 + 30 + 40 = 90; collected = 20 (cash) + 30 (settled) = 50; outstanding = 40.
      expect(res.grandTotal).toBe(90);
      expect(res.collected).toBe(50);
      expect(res.outstanding).toBe(40);
      expect(round2(res.collected + res.outstanding)).toBe(res.grandTotal);
    });

    it('7. byDay merges dining and event revenue on the same date correctly', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([makeOrder({ id: 'o1', totalAmount: 25, deliveredAt: new Date('2026-01-11T10:00:00Z') })])
          : Promise.resolve([]),
      );
      eventsQb.getMany.mockResolvedValue([makeEvent({ startAtLocal: '2026-01-11 18:00' })]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b1', status: 'booked', included: false, totalAmount: 15 }),
      ]);

      const res = await service.totals(HOTEL_ID, dto, now);

      expect(res.byDay).toEqual([{ date: '2026-01-11', dining: 25, events: 15, total: 40 }]);
    });

    it('8. byMethod sums cash/roomCharge across dining and events (unconditional cash + all room-charge regardless of settlement)', async () => {
      ordersRepo.find.mockImplementation((args: any) =>
        args.where.status === 'delivered'
          ? Promise.resolve([
              makeOrder({ id: 'o-cash', paymentMethod: 'cash', totalAmount: 20 }),
              makeOrder({ id: 'o-rc', paymentMethod: 'room_charge', totalAmount: 30 }),
            ])
          : Promise.resolve([]),
      );
      eventsQb.getMany.mockResolvedValue([makeEvent({ startAtLocal: '2026-01-11 10:00' })]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b-cash', status: 'booked', paymentMethod: 'cash', totalAmount: 10 }),
        makeBooking({ id: 'b-rc', status: 'booked', paymentMethod: 'room_charge', totalAmount: 5 }),
      ]);

      const res = await service.totals(HOTEL_ID, dto, now);

      expect(res.byMethod).toEqual({ cash: 30, roomCharge: 35 });
    });

    it('9. period/currency/basis reflect resolved values', async () => {
      const res = await service.totals(HOTEL_ID, dto, now);
      expect(res.period).toEqual({ preset: 'custom', from: '2026-01-10', to: '2026-01-12', days: 3 });
      expect(res.currency).toBe('EGP');
      expect(res.basis).toBe('delivered_booked');
    });

    it('10. maps a ReportPeriodError to BadRequestException with code REPORT_RANGE_INVALID', async () => {
      await expect(service.totals(HOTEL_ID, { preset: 'custom' } as any, now)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      try {
        await service.totals(HOTEL_ID, { preset: 'custom' } as any, now);
        fail('expected totals() to throw');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({ code: 'REPORT_RANGE_INVALID' }),
        );
      }
    });

    function round2(n: number): number {
      return Math.round(n * 100) / 100;
    }
  });
});
