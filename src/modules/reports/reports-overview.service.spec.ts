import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { TenantRequestsService } from '../requests/tenant-requests.service';
import { Stay } from '../tenant-stays/stay.entity';
import { previousWindow, resolvePeriod } from './reports-period';
import { ReportsOperationalService } from './reports-operational.service';
import { ReportsOverviewService } from './reports-overview.service';
import { ReportsRevenueService } from './reports-revenue.service';

const HOTEL_ID = 'hotel-1';
const TZ = 'Africa/Cairo'; // UTC+2 in January — no DST, keeps arithmetic simple.
const NOW = new Date('2026-01-15T09:00:00Z');

const makeHotel = (o: Partial<Hotel> = {}): Hotel =>
  ({
    id: HOTEL_ID,
    timezone: TZ,
    roomsCount: 10,
    currency: 'EGP',
    createdAt: new Date('2020-01-01T00:00:00Z'), // long-established — deltas are never hotel-age-suppressed
    ...o,
  }) as Hotel;

const makeStay = (o: Partial<Stay> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: HOTEL_ID,
    guestsCount: null,
    stayType: 'room_only',
    status: 'active',
    ...o,
  }) as Stay;

/** Minimal RequestsReport shape — only the fields ReportsOverviewService reads. */
const emptyRequestsReport = () => ({
  receivedCount: 0,
  completedCount: 0,
  overallDoneWithSlaCount: 0,
  overallSlaBreachRatePct: null as number | null,
  overallAvgCompletionMinutes: null as number | null,
  byItem: [] as { itemId: string; names: Record<string, string>; count: number }[],
});

describe('ReportsOverviewService (Story 22.1, 22.6 AC2)', () => {
  let service: ReportsOverviewService;
  let hotelsRepo: { findOne: jest.Mock };
  let staysRepo: { find: jest.Mock };
  let operational: { requests: jest.Mock; countArrivals: jest.Mock; countDepartures: jest.Mock };
  let revenue: { dining: jest.Mock; events: jest.Mock; totals: jest.Mock };
  let housekeeping: { counts: jest.Mock };
  let requestsService: { counts: jest.Mock };

  const dto = { preset: 'today' } as any;

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(makeHotel()) };
    staysRepo = { find: jest.fn().mockResolvedValue([]) };
    operational = {
      requests: jest.fn().mockResolvedValue(emptyRequestsReport()),
      countArrivals: jest.fn().mockResolvedValue(0),
      countDepartures: jest.fn().mockResolvedValue(0),
    };
    revenue = { dining: jest.fn(), events: jest.fn(), totals: jest.fn() };
    housekeeping = {
      counts: jest.fn().mockResolvedValue({ toCleanCheckout: 0, toCleanDaily: 0, inProgress: 0, doneToday: 0, dnd: 0 }),
    };
    requestsService = { counts: jest.fn().mockResolvedValue({ open: 0, doneToday: 0, overdueNow: 0 }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsOverviewService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: ReportsOperationalService, useValue: operational },
        { provide: ReportsRevenueService, useValue: revenue },
        { provide: HousekeepingService, useValue: housekeeping },
        { provide: TenantRequestsService, useValue: requestsService },
      ],
    }).compile();
    service = moduleRef.get(ReportsOverviewService);
  });

  it('1. includeRevenue: false -> the returned report has NO revenue key at all', async () => {
    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    expect('revenue' in res).toBe(false);
    expect(Object.keys(res)).not.toContain('revenue');
  });

  it('2. includeRevenue: true -> revenue present and correctly assembled from dining/events/totals', async () => {
    revenue.dining.mockImplementation((_h: string, d: any) => Promise.resolve({ revenueTotal: d.preset === 'custom' ? 300 : 500 }));
    revenue.events.mockImplementation((_h: string, d: any) =>
      Promise.resolve({ totals: { revenue: d.preset === 'custom' ? 100 : 200 } }),
    );
    revenue.totals.mockImplementation((_h: string, d: any) =>
      Promise.resolve(
        d.preset === 'custom'
          ? { grandTotal: 500, byMethod: { cash: 200, roomCharge: 150 }, outstanding: 90 }
          : { grandTotal: 900, byMethod: { cash: 400, roomCharge: 300 }, outstanding: 150 },
      ),
    );

    const res = await service.overview(HOTEL_ID, dto, true, NOW);

    expect(res.revenue).toEqual({
      dining: { value: 500, previous: 300, deltaPct: 66.7 },
      events: { value: 200, previous: 100, deltaPct: 100 },
      total: { value: 900, previous: 500, deltaPct: 80 },
      cash: 400,
      roomCharge: 300,
      unsettledTotal: 150,
      basis: 'delivered_booked',
    });
  });

  it('3. occupancy.pct is computed correctly, and totalRooms === 0 yields pct: 0 (not NaN/Infinity)', async () => {
    staysRepo.find.mockResolvedValue([
      makeStay({ id: 's1', stayType: 'room_only', guestsCount: 2 }),
      makeStay({ id: 's2', stayType: 'room_only', guestsCount: null }),
      makeStay({ id: 's3', stayType: 'all_inclusive', guestsCount: 3 }),
    ]);

    const res = await service.overview(HOTEL_ID, dto, false, NOW);
    expect(res.occupancy.occupiedNow).toBe(3);
    expect(res.occupancy.totalRooms).toBe(10);
    expect(res.occupancy.pct).toBe(30);

    hotelsRepo.findOne.mockResolvedValue(makeHotel({ roomsCount: 0 }));
    const res2 = await service.overview(HOTEL_ID, dto, false, NOW);
    expect(res2.occupancy.pct).toBe(0);
    expect(Number.isFinite(res2.occupancy.pct)).toBe(true);
  });

  it('4. inHouseGuests sums guestsCount ?? 1, correctly treating null as 1', async () => {
    staysRepo.find.mockResolvedValue([
      makeStay({ id: 's1', guestsCount: 2 }),
      makeStay({ id: 's2', guestsCount: null }),
      makeStay({ id: 's3', guestsCount: 3 }),
    ]);

    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    expect(res.occupancy.inHouseGuests).toBe(6); // 2 + 1 + 3
  });

  it('5. stayTypeBreakdown groups active stays by stayType', async () => {
    staysRepo.find.mockResolvedValue([
      makeStay({ id: 's1', stayType: 'room_only' }),
      makeStay({ id: 's2', stayType: 'room_only' }),
      makeStay({ id: 's3', stayType: 'all_inclusive' }),
    ]);

    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    expect(res.occupancy.stayTypeBreakdown).toEqual({ room_only: 2, all_inclusive: 1 });
  });

  it('6. service.openNow comes from requests.counts(hotelId).open, not from requestsNow/requestsPrev', async () => {
    requestsService.counts.mockResolvedValue({ open: 12, doneToday: 5, overdueNow: 2 });
    operational.requests.mockResolvedValue({ ...emptyRequestsReport(), receivedCount: 999 }); // unrelated large number

    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    expect(res.service.openNow).toBe(12);
    expect(requestsService.counts).toHaveBeenCalledWith(HOTEL_ID);
  });

  it('7a. service.received/.completed/.avgCompletionMinutes are honestDelta-wrapped with a delta present', async () => {
    operational.requests.mockImplementation((_h: string, d: any) =>
      Promise.resolve(
        d.preset === 'custom'
          ? { ...emptyRequestsReport(), receivedCount: 40, completedCount: 25, overallAvgCompletionMinutes: 20 }
          : { ...emptyRequestsReport(), receivedCount: 60, completedCount: 50, overallAvgCompletionMinutes: 18 },
      ),
    );

    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    expect(res.service.received).toEqual({ value: 60, previous: 40, deltaPct: 50 });
    expect(res.service.completed).toEqual({ value: 50, previous: 25, deltaPct: 100 });
    expect(res.service.avgCompletionMinutes).toEqual({ value: 18, previous: 20, deltaPct: -10 });
  });

  it('7b. service.received suppresses the delta when the previous period has no baseline (previous <= 0)', async () => {
    operational.requests.mockImplementation((_h: string, d: any) =>
      Promise.resolve(
        d.preset === 'custom' ? { ...emptyRequestsReport(), receivedCount: 0 } : { ...emptyRequestsReport(), receivedCount: 60 },
      ),
    );

    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    expect(res.service.received).toEqual({ value: 60 });
    expect('deltaPct' in res.service.received).toBe(false);
    expect('previous' in res.service.received).toBe(false);
  });

  it('8. service.slaBreachRatePct wires isRatio: true and previousDenominator = requestsPrev.overallDoneWithSlaCount (5-sample floor actually enforced)', async () => {
    operational.requests.mockImplementation((_h: string, d: any) =>
      Promise.resolve(
        d.preset === 'custom'
          ? {
              ...emptyRequestsReport(),
              receivedCount: 40, // deliberately large & unrelated — if the impl wrongly used receivedCount as the
              overallDoneWithSlaCount: 3, // ratio denominator instead of this, the low-sample floor would NOT suppress
              overallSlaBreachRatePct: 10,
            }
          : { ...emptyRequestsReport(), overallSlaBreachRatePct: 20 },
      ),
    );

    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    // previousDenominator (3) < MIN_RATIO_SAMPLE_SIZE (5) -> suppressed, even though
    // both current (20) and previous (10) percentages are defined.
    expect(res.service.slaBreachRatePct).toEqual({ value: 20 });
  });

  it('9. service.topItems is requestsNow.byItem sorted by count descending, capped at 5', async () => {
    const items = [
      { itemId: 'i1', names: { en: 'A' }, count: 3 },
      { itemId: 'i2', names: { en: 'B' }, count: 9 },
      { itemId: 'i3', names: { en: 'C' }, count: 1 },
      { itemId: 'i4', names: { en: 'D' }, count: 7 },
      { itemId: 'i5', names: { en: 'E' }, count: 5 },
      { itemId: 'i6', names: { en: 'F' }, count: 8 },
      { itemId: 'i7', names: { en: 'G' }, count: 2 },
    ];
    operational.requests.mockImplementation((_h: string, d: any) =>
      Promise.resolve(d.preset === 'custom' ? emptyRequestsReport() : { ...emptyRequestsReport(), byItem: items }),
    );

    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    expect(res.service.topItems).toHaveLength(5);
    expect(res.service.topItems.map((i) => i.itemId)).toEqual(['i2', 'i6', 'i4', 'i5', 'i1']);
  });

  it('10. housekeeping fields map correctly from HousekeepingService.counts(), needingCleaning = toCleanCheckout + toCleanDaily', async () => {
    housekeeping.counts.mockResolvedValue({ toCleanCheckout: 3, toCleanDaily: 2, inProgress: 4, doneToday: 7, dnd: 1 });

    const res = await service.overview(HOTEL_ID, dto, false, NOW);

    expect(res.housekeeping).toEqual({ cleanedToday: 7, needingCleaning: 5, inProgress: 4, dnd: 1 });
  });

  it('11. prevDto passed to operational.requests/revenue.* has preset "custom" and from/to equal previousWindow(...)', async () => {
    revenue.dining.mockResolvedValue({ revenueTotal: 0 });
    revenue.events.mockResolvedValue({ totals: { revenue: 0 } });
    revenue.totals.mockResolvedValue({ grandTotal: 0, byMethod: { cash: 0, roomCharge: 0 }, outstanding: 0 });

    await service.overview(HOTEL_ID, dto, true, NOW);

    const resolved = resolvePeriod(TZ, NOW, dto);
    const prevWindow = previousWindow(resolved, TZ, NOW);
    const expectedPrevDto = { preset: 'custom', from: prevWindow.from, to: prevWindow.to };

    expect(operational.requests).toHaveBeenNthCalledWith(2, HOTEL_ID, expectedPrevDto, NOW);
    expect(revenue.dining).toHaveBeenNthCalledWith(2, HOTEL_ID, expectedPrevDto, NOW);
    expect(revenue.events).toHaveBeenNthCalledWith(2, HOTEL_ID, expectedPrevDto, NOW);
    expect(revenue.totals).toHaveBeenNthCalledWith(2, HOTEL_ID, expectedPrevDto, NOW);
  });

  it('12. a period validation error is mapped to BadRequestException', async () => {
    await expect(service.overview(HOTEL_ID, { preset: 'custom' } as any, false, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
