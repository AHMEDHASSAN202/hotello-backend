import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Between, In } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { HousekeepingEvent } from '../housekeeping/housekeeping-event.entity';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { RequestCategory } from '../requests/request-category.entity';
import { GuestRequest } from '../requests/request.entity';
import { hotelLocalParts, naiveUtc } from '../tenant-stays/stay-time';
import { StayRoomChange } from '../tenant-stays/stay-room-change.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ReportsOperationalService } from './reports-operational.service';
import { resolvePeriod } from './reports-period';

const HOTEL_ID = 'hotel-1';
const TZ = 'Africa/Cairo'; // UTC+2 in January — no DST in this month, keeps arithmetic simple.

const makeHotel = (o: Partial<Hotel> = {}): Hotel =>
  ({
    id: HOTEL_ID,
    timezone: TZ,
    roomsCount: 10,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    ...o,
  }) as Hotel;

const makeStay = (o: Partial<Stay> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: HOTEL_ID,
    roomId: 'room-1',
    guestName: 'Guest',
    language: 'en',
    stayType: 'room_only',
    checkInDate: '2026-01-10',
    checkOutDate: '2026-01-11',
    status: 'active',
    checkedOutAt: null,
    ...o,
  }) as Stay;

const makeRequest = (o: Partial<GuestRequest> = {}): GuestRequest =>
  ({
    id: 'req-1',
    hotelId: HOTEL_ID,
    categoryId: 'cat-1',
    itemId: 'item-1',
    itemNames: { en: 'Towels', ar: 'مناشف' },
    status: 'new',
    createdAt: new Date('2026-01-10T10:00:00Z'),
    dueAt: new Date('2026-01-10T10:30:00Z'),
    completedAt: null,
    cancelledReason: null,
    ...o,
  }) as GuestRequest;

const makeEvent = (o: Partial<HousekeepingEvent> = {}): HousekeepingEvent =>
  ({
    id: 'evt-1',
    hotelId: HOTEL_ID,
    roomId: 'room-1',
    eventType: 'flagged',
    cleaningType: null,
    actorId: null,
    assignedToId: null,
    occurredAt: new Date('2026-01-10T08:00:00Z'),
    ...o,
  }) as HousekeepingEvent;

describe('ReportsOperationalService (Story 22.2)', () => {
  let service: ReportsOperationalService;
  let hotelsRepo: { findOne: jest.Mock };
  let staysRepo: { createQueryBuilder: jest.Mock; count: jest.Mock };
  let roomChangesRepo: { count: jest.Mock };
  let requestsRepo: { find: jest.Mock };
  let categoriesRepo: { find: jest.Mock };
  let hkEventsRepo: { find: jest.Mock; findOne: jest.Mock };
  let usersRepo: { find: jest.Mock };
  let housekeepingService: { counts: jest.Mock };
  let qb: Record<string, jest.Mock>;

  beforeEach(async () => {
    qb = {};
    for (const m of ['where', 'andWhere']) qb[m] = jest.fn().mockReturnValue(qb);
    qb.getMany = jest.fn().mockResolvedValue([]);
    qb.getCount = jest.fn().mockResolvedValue(0);

    hotelsRepo = { findOne: jest.fn().mockResolvedValue(makeHotel()) };
    staysRepo = {
      createQueryBuilder: jest.fn(() => qb),
      count: jest.fn().mockResolvedValue(0),
    };
    roomChangesRepo = { count: jest.fn().mockResolvedValue(0) };
    requestsRepo = { find: jest.fn().mockResolvedValue([]) };
    categoriesRepo = { find: jest.fn().mockResolvedValue([]) };
    hkEventsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    usersRepo = { find: jest.fn().mockResolvedValue([]) };
    housekeepingService = {
      counts: jest
        .fn()
        .mockResolvedValue({ toCleanCheckout: 0, toCleanDaily: 0, inProgress: 0, doneToday: 0, dnd: 0 }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsOperationalService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(StayRoomChange), useValue: roomChangesRepo },
        { provide: getRepositoryToken(GuestRequest), useValue: requestsRepo },
        { provide: getRepositoryToken(RequestCategory), useValue: categoriesRepo },
        { provide: getRepositoryToken(HousekeepingEvent), useValue: hkEventsRepo },
        { provide: getRepositoryToken(TenantUser), useValue: usersRepo },
        { provide: HousekeepingService, useValue: housekeepingService },
      ],
    }).compile();
    service = moduleRef.get(ReportsOperationalService);
  });

  // ==================================================================
  // guests
  // ==================================================================
  describe('guests', () => {
    const dto = { preset: 'custom', from: '2026-01-10', to: '2026-01-13' } as any;
    const now = new Date('2026-01-15T10:00:00Z');

    it('1. wires countArrivals through arrivals.value and computes an honest delta', async () => {
      qb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(3); // now, prev

      const res = await service.guests(HOTEL_ID, dto, now);

      expect(res.arrivals).toEqual({ value: 5, previous: 3, deltaPct: 66.7 });
    });

    it('2. wires countDepartures (checked_out + checkedOutAt window) through departures.value and delta', async () => {
      staysRepo.count.mockResolvedValueOnce(2).mockResolvedValueOnce(4); // departuresNow, departuresPrev

      const res = await service.guests(HOTEL_ID, dto, now);

      expect(res.departures).toEqual({ value: 2, previous: 4, deltaPct: -50 });
    });

    it('3. avgLengthOfStayDays counts ONLY stays that departed within the period, not merely-overlapping ones', async () => {
      const stayA = makeStay({
        id: 'stay-departed',
        status: 'checked_out',
        checkInDate: '2026-01-05',
        checkOutDate: '2026-01-11',
        checkedOutAt: new Date('2026-01-11T08:00:00Z'), // inside [fromUtc, toUtcExclusive)
      }); // daysBetween = 6
      const stayB = makeStay({
        id: 'stay-still-active',
        status: 'active', // overlaps the whole period but never departed — must be excluded
        checkInDate: '2025-10-01',
        checkOutDate: '2026-04-01',
        checkedOutAt: null,
      });
      const stayC = makeStay({
        id: 'stay-checked-out-before-window',
        status: 'checked_out',
        checkInDate: '2026-01-08',
        checkOutDate: '2026-01-10',
        checkedOutAt: new Date('2026-01-09T10:00:00Z'), // before fromUtc (2026-01-09T22:00:00Z)
      });
      qb.getMany.mockResolvedValue([stayA, stayB, stayC]);

      const res = await service.guests(HOTEL_ID, dto, now);

      // If stayB (182-day span) were wrongly included, the average would be
      // skewed to ~90+ days instead of the correct 6.
      expect(res.avgLengthOfStayDays).toBe(6);
    });

    it('4. occupancyTrend counts per hotel-local day match hand-computed overlap for varied check-in/out stays', async () => {
      const s1 = makeStay({ id: 's1', checkInDate: '2026-01-08', checkOutDate: '2026-01-11' });
      const s2 = makeStay({ id: 's2', checkInDate: '2026-01-11', checkOutDate: '2026-01-14' });
      const s3 = makeStay({ id: 's3', checkInDate: '2026-01-12', checkOutDate: '2026-01-13' });
      qb.getMany.mockResolvedValue([s1, s2, s3]);

      const res = await service.guests(HOTEL_ID, dto, now);

      expect(res.occupancyTrend).toEqual([
        { date: '2026-01-10', occupied: 1, totalRooms: 10 }, // s1 only
        { date: '2026-01-11', occupied: 1, totalRooms: 10 }, // s1 departed, s2 arrives
        { date: '2026-01-12', occupied: 2, totalRooms: 10 }, // s2 + s3
        { date: '2026-01-13', occupied: 1, totalRooms: 10 }, // s3 departs, s2 remains
      ]);
    });

    it('5. stayTypes/languages tally the distribution over the overlapping set', async () => {
      const s1 = makeStay({ id: 's1', stayType: 'room_only', language: 'en', checkInDate: '2026-01-08', checkOutDate: '2026-01-11' });
      const s2 = makeStay({ id: 's2', stayType: 'half_board', language: 'ar', checkInDate: '2026-01-11', checkOutDate: '2026-01-14' });
      const s3 = makeStay({ id: 's3', stayType: 'room_only', language: 'en', checkInDate: '2026-01-12', checkOutDate: '2026-01-13' });
      qb.getMany.mockResolvedValue([s1, s2, s3]);

      const res = await service.guests(HOTEL_ID, dto, now);

      expect(res.stayTypes).toEqual({ room_only: 2, half_board: 1 });
      expect(res.languages).toEqual({ en: 2, ar: 1 });
    });

    it('6. inHouseNow is a plain current active-stay count, NOT scoped to the (possibly past) period', async () => {
      const pastDto = { preset: 'custom', from: '2020-02-01', to: '2020-02-02' } as any;
      staysRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(9); // departuresNow, departuresPrev, inHouseNow

      const res = await service.guests(HOTEL_ID, pastDto, now);

      expect(res.inHouseNow).toBe(9);
      const inHouseCallArgs = staysRepo.count.mock.calls[2][0];
      expect(inHouseCallArgs).toEqual({ where: { hotelId: HOTEL_ID, status: 'active' } });
    });

    it('7. roomChanges counts via the stay_room_changes window [fromUtc, toUtcExclusive)', async () => {
      const resolved = resolvePeriod(TZ, now, dto);
      roomChangesRepo.count.mockResolvedValueOnce(4);

      const res = await service.guests(HOTEL_ID, dto, now);

      expect(res.roomChanges).toBe(4);
      const callArg = roomChangesRepo.count.mock.calls[0][0];
      expect(callArg.where.hotelId).toBe(HOTEL_ID);
      expect(callArg.where.occurredAt).toEqual(Between(resolved.fromUtc, resolved.toUtcExclusive));
    });

    it('8. suppresses the delta (no deltaPct/previous keys) when the hotel did not exist for the whole previous window', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel({ createdAt: new Date('2026-01-12T00:00:00Z') }));
      qb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

      const res = await service.guests(HOTEL_ID, dto, now);

      expect(res.arrivals).toEqual({ value: 5 });
    });

    it('9. maps a ReportPeriodError to BadRequestException with code REPORT_RANGE_INVALID (shared resolveOrThrow wiring)', async () => {
      await expect(service.guests(HOTEL_ID, { preset: 'custom' } as any, now)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      try {
        await service.guests(HOTEL_ID, { preset: 'custom' } as any, now);
        fail('expected guests() to throw');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({ code: 'REPORT_RANGE_INVALID' }),
        );
      }
    });
  });

  // ==================================================================
  // requests
  // ==================================================================
  describe('requests', () => {
    const dto = { preset: 'custom', from: '2026-01-10', to: '2026-01-11' } as any;
    const now = new Date('2026-01-12T09:00:00Z');

    it('1. queries requestsRepo.find with a naiveUtc-wrapped Between of [fromUtc, toUtcExclusive)', async () => {
      const resolved = resolvePeriod(TZ, now, dto);

      await service.requests(HOTEL_ID, dto, now);

      const callArg = requestsRepo.find.mock.calls[0][0];
      expect(callArg.where.hotelId).toBe(HOTEL_ID);
      expect(callArg.where.createdAt).toEqual(Between(naiveUtc(resolved.fromUtc), naiveUtc(resolved.toUtcExclusive)));
    });

    it('2. period reflects the resolved preset/from/to/days', async () => {
      const res = await service.requests(HOTEL_ID, dto, now);
      expect(res.period).toEqual({ preset: 'custom', from: '2026-01-10', to: '2026-01-11', days: 2 });
    });

    it('3. volumeByDay groups by hotel-local date and sorts ascending regardless of input order', async () => {
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'r2', createdAt: new Date('2026-01-11T05:00:00Z') }),
        makeRequest({ id: 'r1', createdAt: new Date('2026-01-10T05:00:00Z') }),
        makeRequest({ id: 'r3', createdAt: new Date('2026-01-10T20:00:00Z') }),
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.volumeByDay).toEqual([
        { date: '2026-01-10', count: 2 },
        { date: '2026-01-11', count: 1 },
      ]);
    });

    it('4. busiestHours buckets by hotel-local hour, verified against hotelLocalParts directly (not assumed)', async () => {
      const createdAtA = new Date('2026-01-10T13:45:00Z');
      const createdAtB = new Date('2026-01-10T02:10:00Z');
      requestsRepo.find.mockResolvedValue([makeRequest({ id: 'ra', createdAt: createdAtA }), makeRequest({ id: 'rb', createdAt: createdAtB })]);
      const expectedHourA = Math.floor(hotelLocalParts(TZ, createdAtA).minutes / 60);
      const expectedHourB = Math.floor(hotelLocalParts(TZ, createdAtB).minutes / 60);
      expect(expectedHourA).not.toBe(expectedHourB);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.busiestHours).toHaveLength(24);
      expect(res.busiestHours[expectedHourA]).toBe(1);
      expect(res.busiestHours[expectedHourB]).toBe(1);
      expect(res.busiestHours.reduce((a, b) => a + b, 0)).toBe(2);
    });

    it('5. byCategory computes count (incl. non-done rows), slaCompliancePct (3 done/1 breach -> 66.7%) and avgCompletionMinutes', async () => {
      const base = new Date('2026-01-10T10:00:00Z');
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'r1', categoryId: 'cat-1', status: 'done', createdAt: base, completedAt: new Date(base.getTime() + 10 * 60000), dueAt: new Date(base.getTime() + 15 * 60000) }),
        makeRequest({ id: 'r2', categoryId: 'cat-1', status: 'done', createdAt: base, completedAt: new Date(base.getTime() + 25 * 60000), dueAt: new Date(base.getTime() + 15 * 60000) }), // breach
        makeRequest({ id: 'r3', categoryId: 'cat-1', status: 'done', createdAt: base, completedAt: new Date(base.getTime() + 40 * 60000), dueAt: new Date(base.getTime() + 50 * 60000) }),
        makeRequest({ id: 'r4', categoryId: 'cat-1', status: 'new', createdAt: base }), // not done — counts but no SLA contribution
      ]);
      categoriesRepo.find.mockResolvedValue([{ id: 'cat-1', names: { en: 'Housekeeping', ar: 'التدبير المنزلي' } } as RequestCategory]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.byCategory).toEqual([
        { categoryId: 'cat-1', names: { en: 'Housekeeping', ar: 'التدبير المنزلي' }, count: 4, slaCompliancePct: 66.7, avgCompletionMinutes: 25 },
      ]);
      expect(categoriesRepo.find).toHaveBeenCalledWith({ where: { id: In(['cat-1']) } });
    });

    it('6. byCategory reports null slaCompliancePct/avgCompletionMinutes for a category with requests but zero done rows', async () => {
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'r1', categoryId: 'cat-2', status: 'new' }),
        makeRequest({ id: 'r2', categoryId: 'cat-2', status: 'in_progress' }),
      ]);
      categoriesRepo.find.mockResolvedValue([{ id: 'cat-2', names: { en: 'Maintenance' } } as RequestCategory]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.byCategory).toEqual([
        { categoryId: 'cat-2', names: { en: 'Maintenance' }, count: 2, slaCompliancePct: null, avgCompletionMinutes: null },
      ]);
    });

    it('7. skips the categoriesRepo lookup entirely when there are no rows', async () => {
      requestsRepo.find.mockResolvedValue([]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.byCategory).toEqual([]);
      expect(categoriesRepo.find).not.toHaveBeenCalled();
    });

    it('8. byItem counts occurrences and carries names from the first-seen row snapshot', async () => {
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'r1', itemId: 'item-9', itemNames: { en: 'Extra Pillow', ar: 'وسادة إضافية' } }),
        makeRequest({ id: 'r2', itemId: 'item-9', itemNames: { en: 'DIFFERENT (should be ignored)' } }),
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.byItem).toEqual([{ itemId: 'item-9', names: { en: 'Extra Pillow', ar: 'وسادة إضافية' }, count: 2 }]);
    });

    it('9. completionBuckets assigns one request to each of the 5 buckets, exact at the 15/30-minute edges', async () => {
      const base = new Date('2026-01-10T10:00:00Z');
      const farDueAt = new Date(base.getTime() + 999999 * 60000); // never a breach — irrelevant here
      const at = (ms: number) => new Date(base.getTime() + ms);
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'b1', status: 'done', createdAt: base, dueAt: farDueAt, completedAt: at(14 * 60000 + 59000) }), // 14:59 -> <15m
        makeRequest({ id: 'b2', status: 'done', createdAt: base, dueAt: farDueAt, completedAt: at(15 * 60000) }), // 15:00 -> 15-30m
        makeRequest({ id: 'b3', status: 'done', createdAt: base, dueAt: farDueAt, completedAt: at(29 * 60000 + 59000) }), // 29:59 -> 15-30m
        makeRequest({ id: 'b4', status: 'done', createdAt: base, dueAt: farDueAt, completedAt: at(30 * 60000) }), // 30:00 -> 30-60m
        makeRequest({ id: 'b5', status: 'done', createdAt: base, dueAt: farDueAt, completedAt: at(90 * 60000) }), // 1-2h
        makeRequest({ id: 'b6', status: 'done', createdAt: base, dueAt: farDueAt, completedAt: at(150 * 60000) }), // >2h
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.completionBuckets).toEqual([
        { label: '<15m', count: 1 },
        { label: '15-30m', count: 2 },
        { label: '30-60m', count: 1 },
        { label: '1-2h', count: 1 },
        { label: '>2h', count: 1 },
      ]);
    });

    it('10. cancellations tallies count + reasons, falling back to "unknown" for a null cancelledReason', async () => {
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'c1', status: 'cancelled', cancelledReason: 'guest_request' }),
        makeRequest({ id: 'c2', status: 'cancelled', cancelledReason: 'guest_request' }),
        makeRequest({ id: 'c3', status: 'cancelled', cancelledReason: 'not_available' }),
        makeRequest({ id: 'c4', status: 'cancelled', cancelledReason: null }),
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.cancellations).toEqual({
        count: 4,
        reasons: [
          { reason: 'guest_request', count: 2 },
          { reason: 'not_available', count: 1 },
          { reason: 'unknown', count: 1 },
        ],
      });
    });

    it('11. receivedCount equals the fixture total row count regardless of status', async () => {
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'r1', status: 'new' }),
        makeRequest({ id: 'r2', status: 'in_progress' }),
        makeRequest({ id: 'r3', status: 'done', completedAt: new Date('2026-01-10T10:10:00Z') }),
        makeRequest({ id: 'r4', status: 'cancelled', cancelledReason: 'guest_request' }),
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.receivedCount).toBe(4);
    });

    it('12. completedCount equals the count of status="done" rows', async () => {
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'r1', status: 'new' }),
        makeRequest({ id: 'r2', status: 'done', completedAt: new Date('2026-01-10T10:10:00Z') }),
        makeRequest({ id: 'r3', status: 'done', completedAt: new Date('2026-01-10T10:20:00Z') }),
        makeRequest({ id: 'r4', status: 'cancelled', cancelledReason: 'guest_request' }),
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.completedCount).toBe(2);
    });

    it('13. overallSlaBreachRatePct/overallAvgCompletionMinutes combine ALL categories, NOT an unweighted average of per-category rates (cat A: 1/2 breach=50%, cat B: 0/3 breach=0% -> overall must be 1/5=20%, not (50+0)/2=25%)', async () => {
      const base = new Date('2026-01-10T10:00:00Z');
      const at = (mins: number) => new Date(base.getTime() + mins * 60000);
      requestsRepo.find.mockResolvedValue([
        // category A: 2 done, 1 breach (50% per-category rate)
        makeRequest({ id: 'a1', categoryId: 'cat-a', status: 'done', createdAt: base, dueAt: at(15), completedAt: at(10) }), // on time
        makeRequest({ id: 'a2', categoryId: 'cat-a', status: 'done', createdAt: base, dueAt: at(15), completedAt: at(25) }), // breach
        // category B: 3 done, 0 breaches (0% per-category rate)
        makeRequest({ id: 'b1', categoryId: 'cat-b', status: 'done', createdAt: base, dueAt: at(50), completedAt: at(5) }),
        makeRequest({ id: 'b2', categoryId: 'cat-b', status: 'done', createdAt: base, dueAt: at(50), completedAt: at(8) }),
        makeRequest({ id: 'b3', categoryId: 'cat-b', status: 'done', createdAt: base, dueAt: at(50), completedAt: at(12) }),
      ]);
      categoriesRepo.find.mockResolvedValue([
        { id: 'cat-a', names: { en: 'A' } } as RequestCategory,
        { id: 'cat-b', names: { en: 'B' } } as RequestCategory,
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      // Overall: 1 breach out of 5 done-with-SLA rows = 20%.
      // The naive-average bug would produce (50 + 0) / 2 = 25% instead.
      expect(res.overallSlaBreachRatePct).toBe(20);
      // Overall avg completion minutes: (10 + 25 + 5 + 8 + 12) / 5 = 12.
      expect(res.overallAvgCompletionMinutes).toBe(12);
    });

    it('14. overallDoneWithSlaCount equals the total done-with-SLA row count across all categories', async () => {
      const base = new Date('2026-01-10T10:00:00Z');
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'a1', categoryId: 'cat-a', status: 'done', createdAt: base, dueAt: base, completedAt: base }),
        makeRequest({ id: 'a2', categoryId: 'cat-a', status: 'done', createdAt: base, dueAt: base, completedAt: base }),
        makeRequest({ id: 'b1', categoryId: 'cat-b', status: 'done', createdAt: base, dueAt: base, completedAt: base }),
        makeRequest({ id: 'b2', categoryId: 'cat-b', status: 'new' }), // not done — excluded
      ]);
      categoriesRepo.find.mockResolvedValue([
        { id: 'cat-a', names: { en: 'A' } } as RequestCategory,
        { id: 'cat-b', names: { en: 'B' } } as RequestCategory,
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.overallDoneWithSlaCount).toBe(3);
    });

    it('15. overallSlaBreachRatePct/overallAvgCompletionMinutes are null when zero rows are done in the period, even though receivedCount > 0', async () => {
      requestsRepo.find.mockResolvedValue([
        makeRequest({ id: 'r1', status: 'new' }),
        makeRequest({ id: 'r2', status: 'in_progress' }),
      ]);

      const res = await service.requests(HOTEL_ID, dto, now);

      expect(res.receivedCount).toBe(2);
      expect(res.overallDoneWithSlaCount).toBe(0);
      expect(res.overallSlaBreachRatePct).toBeNull();
      expect(res.overallAvgCompletionMinutes).toBeNull();
    });

    it('16. countArrivals/countDepartures are callable directly (no longer private) and return the exact same values guests() derives from them', async () => {
      qb.getCount = jest.fn().mockResolvedValue(3);
      staysRepo.count = jest.fn().mockResolvedValue(2);

      const directArrivals = await service.countArrivals(HOTEL_ID, '2026-01-10', '2026-01-10');
      const directDepartures = await service.countDepartures(
        HOTEL_ID,
        new Date('2026-01-10T00:00:00Z'),
        new Date('2026-01-11T00:00:00Z'),
      );
      expect(directArrivals).toBe(3);
      expect(directDepartures).toBe(2);

      const guestsReport = await service.guests(HOTEL_ID, { preset: 'today' } as any, new Date('2026-01-10T09:00:00Z'));
      expect(guestsReport.arrivals.value).toBe(directArrivals);
      expect(guestsReport.departures.value).toBe(directDepartures);
    });
  });

  // ==================================================================
  // housekeeping
  // ==================================================================
  describe('housekeeping', () => {
    const dto = { preset: 'custom', from: '2026-01-10', to: '2026-01-13' } as any; // days = 4
    const now = new Date('2026-01-15T09:00:00Z');
    // fromUtc = 2026-01-09T22:00:00Z, toUtcExclusive = 2026-01-13T22:00:00Z, lookbackFrom = 2026-01-06T22:00:00Z

    it('1. cleanedByDay splits completed events by cleaningType, per hotel-local day', async () => {
      hkEventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'e1', roomId: 'r1', eventType: 'completed', cleaningType: 'checkout', actorId: 'staff-1', occurredAt: new Date('2026-01-10T09:00:00Z') }),
        makeEvent({ id: 'e2', roomId: 'r2', eventType: 'completed', cleaningType: 'daily', actorId: 'staff-2', occurredAt: new Date('2026-01-11T09:00:00Z') }),
      ]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.cleanedByDay).toEqual([
        { date: '2026-01-10', checkout: 1, daily: 0 },
        { date: '2026-01-11', checkout: 0, daily: 1 },
      ]);
    });

    it('2. avgFlagToCleanMinutes pairs a flag->complete fully inside the period', async () => {
      hkEventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'f1', roomId: 'rA', eventType: 'flagged', occurredAt: new Date('2026-01-10T08:00:00Z') }),
        makeEvent({ id: 'c1', roomId: 'rA', eventType: 'completed', cleaningType: 'checkout', occurredAt: new Date('2026-01-10T09:30:00Z') }),
      ]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.avgFlagToCleanMinutes).toBe(90);
    });

    it('3. the 3-day lookback lets a flag raised before the period pair with a completion inside it', async () => {
      hkEventsRepo.find.mockResolvedValue([
        // flagged before fromUtc (2026-01-09T22:00Z) but within the 3-day lookback (>= 2026-01-06T22:00Z)
        makeEvent({ id: 'f1', roomId: 'rB', eventType: 'flagged', occurredAt: new Date('2026-01-08T10:00:00Z') }),
        makeEvent({ id: 'c1', roomId: 'rB', eventType: 'completed', cleaningType: 'daily', occurredAt: new Date('2026-01-10T12:00:00Z') }),
      ]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.avgFlagToCleanMinutes).toBe(3000); // 2 days 2 hours
    });

    it('4. a flag+complete pair BOTH before the period is excluded and does not corrupt a later pairing for the same room', async () => {
      hkEventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'f1', roomId: 'rC', eventType: 'flagged', occurredAt: new Date('2026-01-07T08:00:00Z') }),
        makeEvent({ id: 'c1', roomId: 'rC', eventType: 'completed', cleaningType: 'checkout', occurredAt: new Date('2026-01-08T09:00:00Z') }), // also before fromUtc
        makeEvent({ id: 'f2', roomId: 'rC', eventType: 'flagged', occurredAt: new Date('2026-01-11T08:00:00Z') }),
        makeEvent({ id: 'c2', roomId: 'rC', eventType: 'completed', cleaningType: 'checkout', occurredAt: new Date('2026-01-11T08:20:00Z') }),
      ]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      // Only the second (in-period) pair counts: 20 minutes. A bug that let the
      // stale first pairing leak through would either skip this pair or
      // (worse) blend in the multi-day gap from the first, out-of-period pair.
      expect(res.avgFlagToCleanMinutes).toBe(20);
    });

    it('5. an interrupted event between flag and complete does NOT clear the open flag — duration spans from the ORIGINAL flag', async () => {
      hkEventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'f1', roomId: 'rD', eventType: 'flagged', occurredAt: new Date('2026-01-10T06:00:00Z') }),
        makeEvent({ id: 'i1', roomId: 'rD', eventType: 'interrupted', occurredAt: new Date('2026-01-10T06:30:00Z') }),
        makeEvent({ id: 'c1', roomId: 'rD', eventType: 'completed', cleaningType: 'daily', occurredAt: new Date('2026-01-10T07:15:00Z') }),
      ]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      // From 06:00 (original flag) to 07:15 = 75 minutes. A bug that reset the
      // open-flag time on 'interrupted' would instead give 45 minutes (from 06:30).
      expect(res.avgFlagToCleanMinutes).toBe(75);
    });

    it('6. a cleared event with no completion records no duration, and does not corrupt a later pairing for the same room', async () => {
      hkEventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'f1', roomId: 'rE', eventType: 'flagged', occurredAt: new Date('2026-01-10T05:00:00Z') }),
        makeEvent({ id: 'cl1', roomId: 'rE', eventType: 'cleared', occurredAt: new Date('2026-01-10T05:10:00Z') }),
        // Orphan completion with no open flag (cleared already dropped it) — must not pair.
        makeEvent({ id: 'c-orphan', roomId: 'rE', eventType: 'completed', cleaningType: 'daily', occurredAt: new Date('2026-01-10T05:20:00Z') }),
        makeEvent({ id: 'f2', roomId: 'rE', eventType: 'flagged', occurredAt: new Date('2026-01-10T07:00:00Z') }),
        makeEvent({ id: 'c2', roomId: 'rE', eventType: 'completed', cleaningType: 'daily', occurredAt: new Date('2026-01-10T07:30:00Z') }),
      ]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      // Only the second pair (07:00 -> 07:30 = 30 min) counts.
      expect(res.avgFlagToCleanMinutes).toBe(30);
    });

    it('7. attendants group by assignedToId ?? actorId, excluding events where BOTH are null', async () => {
      hkEventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'e1', roomId: 'r1', eventType: 'completed', cleaningType: 'checkout', assignedToId: 'user-A', actorId: 'staff-x', occurredAt: new Date('2026-01-10T09:00:00Z') }),
        makeEvent({ id: 'e2', roomId: 'r2', eventType: 'completed', cleaningType: 'daily', assignedToId: null, actorId: 'staff-y', occurredAt: new Date('2026-01-10T10:00:00Z') }),
        makeEvent({ id: 'e3', roomId: 'r3', eventType: 'completed', cleaningType: 'checkout', assignedToId: null, actorId: null, occurredAt: new Date('2026-01-10T11:00:00Z') }), // pure system event
      ]);
      usersRepo.find.mockResolvedValue([
        { id: 'user-A', name: 'Amina' } as TenantUser,
        { id: 'staff-y', name: 'Yusuf' } as TenantUser,
      ]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.attendants).toEqual([
        { userId: 'user-A', name: 'Amina', completed: 1, perDay: 0.3 },
        { userId: 'staff-y', name: 'Yusuf', completed: 1, perDay: 0.3 },
      ]);
      expect(usersRepo.find).toHaveBeenCalledWith({ where: { id: In(['user-A', 'staff-y']) } });
    });

    it('8. perDay divides completed count by resolved.days', async () => {
      const days = ['2026-01-10', '2026-01-11', '2026-01-12', '2026-01-13'];
      const events = Array.from({ length: 8 }, (_, i) =>
        makeEvent({
          id: `e${i}`,
          roomId: 'room-P',
          eventType: 'completed',
          cleaningType: 'daily',
          assignedToId: 'user-P',
          occurredAt: new Date(`${days[i % 4]}T0${(i % 6) + 1}:00:00Z`),
        }),
      );
      hkEventsRepo.find.mockResolvedValue(events);
      usersRepo.find.mockResolvedValue([{ id: 'user-P', name: 'Peter' } as TenantUser]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      const attendant = res.attendants.find((a) => a.userId === 'user-P')!;
      expect(attendant.completed).toBe(8);
      expect(attendant.perDay).toBe(2); // 8 / 4 days
    });

    it('9a. dataSince is present when the earliest housekeeping event for the hotel is AFTER the period fromDate', async () => {
      hkEventsRepo.findOne.mockResolvedValue(makeEvent({ occurredAt: new Date('2026-01-11T05:00:00Z') }));

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.dataSince).toBe('2026-01-11');
    });

    it('9b. dataSince is absent when the earliest housekeeping event is at/before the period fromDate', async () => {
      hkEventsRepo.findOne.mockResolvedValue(makeEvent({ occurredAt: new Date('2026-01-05T00:00:00Z') }));

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.dataSince).toBeUndefined();
    });

    it('9c. dataSince is absent when there is no housekeeping data at all for the hotel', async () => {
      hkEventsRepo.findOne.mockResolvedValue(null);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.dataSince).toBeUndefined();
    });

    it('10. dndClearedCount only counts dnd_cleared events inside the true period', async () => {
      hkEventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'd1', roomId: 'r1', eventType: 'dnd_cleared', occurredAt: new Date('2026-01-10T10:00:00Z') }),
        makeEvent({ id: 'd2', roomId: 'r2', eventType: 'dnd_cleared', occurredAt: new Date('2026-01-11T10:00:00Z') }),
        makeEvent({ id: 'd3', roomId: 'r3', eventType: 'dnd_cleared', occurredAt: new Date('2026-01-05T10:00:00Z') }), // before fromUtc
      ]);

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.dndClearedCount).toBe(2);
    });

    it('11. dndNow comes from housekeeping.counts(hotelId).dnd, not from dndClearedCount', async () => {
      hkEventsRepo.find.mockResolvedValue([
        makeEvent({ id: 'd1', roomId: 'r1', eventType: 'dnd_cleared', occurredAt: new Date('2026-01-10T10:00:00Z') }),
        makeEvent({ id: 'd2', roomId: 'r2', eventType: 'dnd_cleared', occurredAt: new Date('2026-01-11T10:00:00Z') }),
      ]);
      housekeepingService.counts.mockResolvedValue({ toCleanCheckout: 0, toCleanDaily: 0, inProgress: 0, doneToday: 0, dnd: 7 });

      const res = await service.housekeeping(HOTEL_ID, dto, now);

      expect(res.dndClearedCount).toBe(2);
      expect(res.dndNow).toBe(7);
      expect(housekeepingService.counts).toHaveBeenCalledWith(HOTEL_ID);
    });
  });

  // ==================================================================
  // shared
  // ==================================================================
  describe('shared', () => {
    it('maps a ReportPeriodError to BadRequestException with code REPORT_RANGE_INVALID (resolveOrThrow wiring)', async () => {
      await expect(
        service.housekeeping(HOTEL_ID, { preset: 'custom' } as any, new Date('2026-01-15T00:00:00Z')),
      ).rejects.toBeInstanceOf(BadRequestException);
      try {
        await service.housekeeping(HOTEL_ID, { preset: 'custom' } as any, new Date('2026-01-15T00:00:00Z'));
        fail('expected housekeeping() to throw');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({ code: 'REPORT_RANGE_INVALID' }),
        );
      }
    });
  });
});
