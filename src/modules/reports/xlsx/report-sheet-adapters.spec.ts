import {
  BalancesReport,
  DiningReport,
  EventsReport,
  GuestsReport,
  HousekeepingReport,
  LeakageReport,
  OverviewReport,
  RequestsReport,
  TotalsReport,
} from '../report-views';
import {
  balancesSheets,
  diningSheets,
  eventsSheets,
  guestsSheets,
  housekeepingSheets,
  leakageSheets,
  overviewSheets,
  requestsSheets,
  totalsSheets,
} from './report-sheet-adapters';

const PERIOD = { preset: 'last7' as const, from: '2026-03-01', to: '2026-03-07', days: 7 };

describe('report-sheet-adapters (Story 22.5)', () => {
  describe('overviewSheets', () => {
    const base: OverviewReport = {
      period: PERIOD,
      currency: 'EGP',
      occupancy: {
        occupiedNow: 10,
        totalRooms: 20,
        pct: 50,
        arrivalsToday: 3,
        departuresToday: 2,
        inHouseGuests: 15,
        stayTypeBreakdown: {},
      },
      service: {
        received: { value: 40 },
        completed: { value: 35 },
        openNow: 5,
        avgCompletionMinutes: { value: 22 },
        slaBreachRatePct: { value: 4 },
        topItems: [],
      },
      housekeeping: { cleanedToday: 8, needingCleaning: 2, inProgress: 1, dnd: 3 },
    };

    it('has one sheet named Overview with Metric/Value headers, no revenue rows when r.revenue is absent', () => {
      const sheets = overviewSheets(base);

      expect(sheets).toHaveLength(1);
      expect(sheets[0].name).toBe('Overview');
      expect(sheets[0].headers).toEqual(['Metric', 'Value']);
      const metrics = sheets[0].rows.map((r) => r[0]);
      expect(metrics).not.toContain('Dining revenue');
      expect(sheets[0].rows).toContainEqual(['Occupied rooms', 10]);
      expect(sheets[0].rows).toContainEqual(['DND rooms', 3]);
    });

    it('includes the revenue rows when r.revenue is present', () => {
      const withRevenue: OverviewReport = {
        ...base,
        revenue: {
          dining: { value: 1000 },
          events: { value: 500 },
          total: { value: 1500 },
          cash: 900,
          roomCharge: 600,
          unsettledTotal: 200,
          basis: 'delivered_booked',
        },
      };

      const sheets = overviewSheets(withRevenue);

      expect(sheets[0].rows).toContainEqual(['Dining revenue', 1000]);
      expect(sheets[0].rows).toContainEqual(['Events revenue', 500]);
      expect(sheets[0].rows).toContainEqual(['Total revenue', 1500]);
      expect(sheets[0].rows).toContainEqual(['Cash', 900]);
      expect(sheets[0].rows).toContainEqual(['Room charge', 600]);
      expect(sheets[0].rows).toContainEqual(['Unsettled total', 200]);
    });
  });

  describe('guestsSheets', () => {
    it('maps occupancyTrend to one sheet, Date/Occupied/Total rooms headers', () => {
      const r: GuestsReport = {
        period: PERIOD,
        arrivals: { value: 3 },
        departures: { value: 2 },
        inHouseNow: 15,
        avgLengthOfStayDays: 2.5,
        occupancyTrend: [{ date: '2026-03-01', occupied: 10, totalRooms: 20 }],
        stayTypes: {},
        languages: {},
        roomChanges: 0,
      };

      const sheets = guestsSheets(r);

      expect(sheets).toHaveLength(1);
      expect(sheets[0].name).toBe('Occupancy by day');
      expect(sheets[0].headers).toEqual(['Date', 'Occupied', 'Total rooms']);
      expect(sheets[0].rows).toEqual([['2026-03-01', 10, 20]]);
    });
  });

  describe('requestsSheets', () => {
    it('produces 3 sheets (Volume by day, By category, By item) with the right headers/rows, nameOf falls back when only ar is present', () => {
      const r: RequestsReport = {
        period: PERIOD,
        receivedCount: 10,
        completedCount: 8,
        overallDoneWithSlaCount: 8,
        overallSlaBreachRatePct: 5,
        overallAvgCompletionMinutes: 20,
        volumeByDay: [{ date: '2026-03-01', count: 4 }],
        byCategory: [
          {
            categoryId: 'cat-1',
            names: { ar: 'تنظيف' },
            count: 6,
            slaCompliancePct: 90,
            avgCompletionMinutes: 15,
          },
          {
            categoryId: 'cat-2',
            names: { en: 'Towels' },
            count: 2,
            slaCompliancePct: null,
            avgCompletionMinutes: null,
          },
        ],
        byItem: [{ itemId: 'item-1', names: { en: 'Extra towel' }, count: 3 }],
        completionBuckets: [],
        cancellations: { count: 0, reasons: [] },
        busiestHours: [],
      };

      const sheets = requestsSheets(r);

      expect(sheets).toHaveLength(3);
      expect(sheets[0]).toEqual({
        name: 'Volume by day',
        headers: ['Date', 'Count'],
        rows: [['2026-03-01', 4]],
      });
      expect(sheets[1].name).toBe('By category');
      expect(sheets[1].headers).toEqual(['Category', 'Count', 'SLA compliance %', 'Avg completion (min)']);
      expect(sheets[1].rows).toEqual([
        ['تنظيف', 6, 90, 15],
        ['Towels', 2, '', ''],
      ]);
      expect(sheets[2]).toEqual({
        name: 'By item',
        headers: ['Item', 'Count'],
        rows: [['Extra towel', 3]],
      });
    });
  });

  describe('housekeepingSheets', () => {
    it('produces 2 sheets (Cleaned by day, By attendant) with the right headers/rows', () => {
      const r: HousekeepingReport = {
        period: PERIOD,
        cleanedByDay: [{ date: '2026-03-01', checkout: 3, daily: 5 }],
        avgFlagToCleanMinutes: 12,
        attendants: [{ userId: 'u1', name: 'Fatima', completed: 20, perDay: 4 }],
        dndClearedCount: 1,
        dndNow: 2,
      };

      const sheets = housekeepingSheets(r);

      expect(sheets).toHaveLength(2);
      expect(sheets[0]).toEqual({
        name: 'Cleaned by day',
        headers: ['Date', 'Checkout', 'Daily'],
        rows: [['2026-03-01', 3, 5]],
      });
      expect(sheets[1]).toEqual({
        name: 'By attendant',
        headers: ['Attendant', 'Completed', 'Per day'],
        rows: [['Fatima', 20, 4]],
      });
    });
  });

  describe('diningSheets', () => {
    it('produces 3 sheets (Revenue by day, Top items, By zone), room zone renders as "Room", nameOf falls back for named zones', () => {
      const r: DiningReport = {
        period: PERIOD,
        currency: 'EGP',
        revenueByDay: [{ date: '2026-03-01', revenue: 500, orders: 10 }],
        ordersCount: 10,
        revenueTotal: 500,
        avgOrderValue: 50,
        topItems: [{ itemId: 'i1', names: { en: 'Burger' }, qty: 5, revenue: 250 }],
        includedConsumption: [],
        byZone: [
          { destinationType: 'room', locationKey: null, names: null, revenue: 300, orders: 6 },
          { destinationType: 'location', locationKey: 'pool', names: { ar: 'المسبح' }, revenue: 200, orders: 4 },
        ],
        paymentSplit: { cash: 200, roomCharge: 300 },
        cancellations: { count: 0, reasons: [] },
        basis: 'delivered_only',
      };

      const sheets = diningSheets(r);

      expect(sheets).toHaveLength(3);
      expect(sheets[0]).toEqual({
        name: 'Revenue by day',
        headers: ['Date', 'Revenue', 'Orders'],
        rows: [['2026-03-01', 500, 10]],
      });
      expect(sheets[1]).toEqual({
        name: 'Top items',
        headers: ['Item', 'Qty', 'Revenue'],
        rows: [['Burger', 5, 250]],
      });
      expect(sheets[2].name).toBe('By zone');
      expect(sheets[2].headers).toEqual(['Zone', 'Revenue', 'Orders']);
      expect(sheets[2].rows).toEqual([
        ['Room', 300, 6],
        ['المسبح', 200, 4],
      ]);
    });
  });

  describe('eventsSheets', () => {
    it('has one Events sheet with the right headers/rows, nameOf falls back for titles', () => {
      const r: EventsReport = {
        period: PERIOD,
        currency: 'EGP',
        events: [
          {
            eventId: 'e1',
            titles: { ar: 'حفل موسيقي' },
            startAtLocal: '2026-03-02T19:00:00',
            capacity: 100,
            booked: 40,
            revenue: 2000,
            paidSeats: 30,
            freeSeats: 5,
            includedSeats: 5,
            cancellationRatePct: 2.5,
          },
        ],
        totals: { revenue: 2000, booked: 40, cancellationRatePct: 2.5 },
        basis: 'events_starting_in_period',
      };

      const sheets = eventsSheets(r);

      expect(sheets).toHaveLength(1);
      expect(sheets[0].name).toBe('Events');
      expect(sheets[0].headers).toEqual(['Event', 'Start', 'Booked', 'Revenue', 'Cancellation rate %']);
      expect(sheets[0].rows).toEqual([['حفل موسيقي', '2026-03-02T19:00:00', 40, 2000, 2.5]]);
    });
  });

  describe('totalsSheets', () => {
    it('has one "Totals by day" sheet with the right headers/rows', () => {
      const r: TotalsReport = {
        period: PERIOD,
        currency: 'EGP',
        byDay: [{ date: '2026-03-01', dining: 500, events: 200, total: 700 }],
        byMethod: { cash: 400, roomCharge: 300 },
        grandTotal: 700,
        collected: 700,
        outstanding: 0,
        basis: 'delivered_booked',
      };

      const sheets = totalsSheets(r);

      expect(sheets).toEqual([
        {
          name: 'Totals by day',
          headers: ['Date', 'Dining', 'Events', 'Total'],
          rows: [['2026-03-01', 500, 200, 700]],
        },
      ]);
    });
  });

  describe('balancesSheets', () => {
    it('has one Balances sheet with the right headers/rows', () => {
      const r: BalancesReport = {
        currency: 'EGP',
        departingTodayCount: 1,
        departingTodayTotal: 100,
        totalOutstanding: 100,
        rows: [
          {
            stayId: 's1',
            roomId: 'room-1',
            roomNumber: '101',
            guestName: 'John Doe',
            checkOutDate: '2026-03-10',
            departsToday: false,
            total: 100,
            byKey: { fnb: 60, events: 40 },
            oldestUnsettledAt: '2026-03-05T10:00:00.000Z',
          },
        ],
      };

      const sheets = balancesSheets(r);

      expect(sheets).toEqual([
        {
          name: 'Balances',
          headers: ['Room', 'Guest', 'Checkout date', 'Total', 'Dining', 'Events'],
          rows: [['101', 'John Doe', '2026-03-10', 100, 60, 40]],
        },
      ]);
    });
  });

  describe('leakageSheets', () => {
    it('has one Leakage sheet with the right headers/rows', () => {
      const r: LeakageReport = {
        period: PERIOD,
        currency: 'EGP',
        totalLost: 80,
        rows: [
          {
            stayId: 's1',
            roomNumber: '202',
            guestName: 'Jane Roe',
            checkedOutAt: '2026-03-06T08:00:00.000Z',
            checkoutType: 'automatic',
            total: 80,
            byKey: { fnb: 80, events: 0 },
          },
        ],
      };

      const sheets = leakageSheets(r);

      expect(sheets).toEqual([
        {
          name: 'Leakage',
          headers: ['Room', 'Guest', 'Checked out', 'Type', 'Total'],
          rows: [['202', 'Jane Roe', '2026-03-06T08:00:00.000Z', 'automatic', 80]],
        },
      ]);
    });
  });
});
