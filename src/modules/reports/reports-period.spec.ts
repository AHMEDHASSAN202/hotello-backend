import {
  ReportPeriodError,
  honestDelta,
  previousWindow,
  resolvePeriod,
  utcInstantOfLocalMidnight,
} from './reports-period';
import { hotelLocalParts } from '../tenant-stays/stay-time';

const CAIRO = 'Africa/Cairo';
const NY = 'America/New_York';

/** Plain 'YYYY-MM-DD' string arithmetic, test-local (no calendar library). */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('reports-period (Story 22.1 AC1/AC6)', () => {
  describe('utcInstantOfLocalMidnight', () => {
    it('resolves a plain non-DST Africa/Cairo date to local midnight (case 1)', () => {
      const dateStr = '2026-03-05'; // Cairo winter, GMT+2, no nearby transition
      const instant = utcInstantOfLocalMidnight(CAIRO, dateStr);
      const parts = hotelLocalParts(CAIRO, instant);
      expect(parts.date).toBe(dateStr);
      expect(parts.minutes).toBe(0);
    });

    it('resolves a negative-UTC-offset America/New_York date to local midnight (case 2)', () => {
      const dateStr = '2026-03-05';
      const instant = utcInstantOfLocalMidnight(NY, dateStr);
      const parts = hotelLocalParts(NY, instant);
      expect(parts.date).toBe(dateStr);
      expect(parts.minutes).toBe(0);
    });

    it('corrects across a Cairo DST transition day (case 3, two-pass correction)', () => {
      // Verified live: Cairo's 2023 DST-end (fall-back) transition occurred at
      // 2023-10-26T21:00:00Z (GMT+3 -> GMT+2). A naive single-pass guess for
      // 2023-10-27T00:00:00Z overshoots local midnight by two hours; the
      // second correction pass fixes it.
      const dateStr = '2023-10-27';
      const instant = utcInstantOfLocalMidnight(CAIRO, dateStr);
      const parts = hotelLocalParts(CAIRO, instant);
      expect(parts.date).toBe(dateStr);
      expect(parts.minutes).toBe(0);
    });
  });

  describe('resolvePeriod', () => {
    const now = new Date('2026-03-05T10:00:00Z'); // Cairo local 2026-03-05 12:00

    it("preset 'today' (case 4)", () => {
      const currentLocalDate = hotelLocalParts(CAIRO, now).date;
      const period = resolvePeriod(CAIRO, now, { preset: 'today' });
      expect(period.fromDate).toBe(currentLocalDate);
      expect(period.toDate).toBe(currentLocalDate);
      expect(period.days).toBe(1);
      expect(period.endsToday).toBe(true);
    });

    it("preset 'yesterday' (case 5)", () => {
      const currentLocalDate = hotelLocalParts(CAIRO, now).date;
      const expectedDate = shiftDate(currentLocalDate, -1);
      const period = resolvePeriod(CAIRO, now, { preset: 'yesterday' });
      expect(period.fromDate).toBe(expectedDate);
      expect(period.toDate).toBe(expectedDate);
      expect(period.days).toBe(1);
      expect(period.endsToday).toBe(false);
    });

    it("preset 'last7' (case 6)", () => {
      const currentLocalDate = hotelLocalParts(CAIRO, now).date;
      const period = resolvePeriod(CAIRO, now, { preset: 'last7' });
      expect(period.toDate).toBe(currentLocalDate);
      expect(period.fromDate).toBe(shiftDate(currentLocalDate, -6));
      expect(period.days).toBe(7);
      expect(period.endsToday).toBe(true);
    });

    it("preset 'last30' (case 7)", () => {
      const currentLocalDate = hotelLocalParts(CAIRO, now).date;
      const period = resolvePeriod(CAIRO, now, { preset: 'last30' });
      expect(period.toDate).toBe(currentLocalDate);
      expect(period.fromDate).toBe(shiftDate(currentLocalDate, -29));
      expect(period.days).toBe(30);
      expect(period.endsToday).toBe(true);
    });

    it('custom range well in the past (case 8)', () => {
      const period = resolvePeriod(CAIRO, now, {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-10',
      });
      expect(period.days).toBe(10);
      expect(period.endsToday).toBe(false);
      expect(period.toUtcExclusive).toEqual(
        utcInstantOfLocalMidnight(CAIRO, '2026-01-11'),
      );
    });

    it("clamps a future `to` down to the hotel's current local date instead of throwing (case 9)", () => {
      const currentLocalDate = hotelLocalParts(CAIRO, now).date;
      const period = resolvePeriod(CAIRO, now, {
        preset: 'custom',
        from: '2026-01-01',
        to: '2030-01-01',
      });
      expect(period.toDate).toBe(currentLocalDate);
    });

    it('throws REPORT_RANGE_INVALID when from > to after any clamping (case 10)', () => {
      expect.assertions(2);
      try {
        resolvePeriod(CAIRO, now, {
          preset: 'custom',
          from: '2026-05-01',
          to: '2026-04-01',
        });
      } catch (e) {
        expect(e).toBeInstanceOf(ReportPeriodError);
        expect((e as ReportPeriodError).code).toBe('REPORT_RANGE_INVALID');
      }
    });

    it('throws REPORT_RANGE_TOO_LARGE for a 367+ day custom span (case 11)', () => {
      const from = '2020-01-01';
      const to = shiftDate(from, 367); // 368 inclusive days
      const laterNow = new Date('2025-01-01T00:00:00Z');
      expect.assertions(2);
      try {
        resolvePeriod(CAIRO, laterNow, { preset: 'custom', from, to });
      } catch (e) {
        expect(e).toBeInstanceOf(ReportPeriodError);
        expect((e as ReportPeriodError).code).toBe('REPORT_RANGE_TOO_LARGE');
      }
    });

    it('does not throw for an exactly-366-day custom span (case 12)', () => {
      const from = '2020-01-01';
      const to = shiftDate(from, 365); // 366 inclusive days
      const laterNow = new Date('2025-01-01T00:00:00Z');
      const period = resolvePeriod(CAIRO, laterNow, {
        preset: 'custom',
        from,
        to,
      });
      expect(period.days).toBe(366);
    });
  });

  describe('previousWindow', () => {
    const now = new Date('2026-03-05T10:00:00Z'); // Cairo local 2026-03-05 12:00

    it("non-partial window for preset 'yesterday' (case 13)", () => {
      const period = resolvePeriod(CAIRO, now, { preset: 'yesterday' });
      const prev = previousWindow(period, CAIRO, now);
      const expectedTo = shiftDate(period.fromDate, -1);
      const expectedFrom = shiftDate(expectedTo, -(period.days - 1));
      expect(prev.partial).toBe(false);
      expect(prev.to).toBe(expectedTo);
      expect(prev.from).toBe(expectedFrom);
      expect(prev.toUtcExclusive).toEqual(
        utcInstantOfLocalMidnight(CAIRO, shiftDate(expectedTo, 1)),
      );
    });

    it("partial window for preset 'today', capped at the elapsed minute-of-day (case 14)", () => {
      const nowAt1430 = new Date('2026-03-05T12:30:00Z'); // Cairo local 14:30
      const period = resolvePeriod(CAIRO, nowAt1430, { preset: 'today' });
      const prev = previousWindow(period, CAIRO, nowAt1430);
      const expectedTo = shiftDate(period.fromDate, -1);
      const minutesElapsed = hotelLocalParts(CAIRO, nowAt1430).minutes;
      expect(minutesElapsed).toBe(14 * 60 + 30);
      expect(prev.partial).toBe(true);
      expect(prev.to).toBe(expectedTo);
      expect(prev.toUtcExclusive).toEqual(
        new Date(
          utcInstantOfLocalMidnight(CAIRO, expectedTo).getTime() +
            minutesElapsed * 60_000,
        ),
      );
    });

    it("partial window for preset 'last7' (case 15)", () => {
      const period = resolvePeriod(CAIRO, now, { preset: 'last7' });
      const prev = previousWindow(period, CAIRO, now);
      expect(prev.partial).toBe(true);
      expect(prev.from).toBe(shiftDate(period.fromDate, -7));
      expect(prev.to).toBe(shiftDate(period.toDate, -7));
    });
  });

  describe('honestDelta', () => {
    it('suppresses when the hotel was created after the previous window start (case 16)', () => {
      const result = honestDelta(120, 100, '2026-01-01', {
        hotelCreatedAtLocalDate: '2026-01-05',
      });
      expect('deltaPct' in result).toBe(false);
      expect('previous' in result).toBe(false);
      expect(result.value).toBe(120);
    });

    it('suppresses a count metric when previous is 0 (case 17)', () => {
      const result = honestDelta(10, 0, '2020-01-01', {
        hotelCreatedAtLocalDate: '2019-01-01',
      });
      expect('deltaPct' in result).toBe(false);
      expect('previous' in result).toBe(false);
    });

    it('computes delta for a count metric that increased (case 18a)', () => {
      const result = honestDelta(120, 100, '2020-01-01', {
        hotelCreatedAtLocalDate: '2019-01-01',
      });
      expect('deltaPct' in result).toBe(true);
      expect(result.previous).toBe(100);
      expect(result.deltaPct).toBe(20);
    });

    it('computes delta for a count metric that decreased (case 18b)', () => {
      const result = honestDelta(80, 100, '2020-01-01', {
        hotelCreatedAtLocalDate: '2019-01-01',
      });
      expect(result.deltaPct).toBe(-20);
    });

    it('suppresses a ratio metric below the 5-sample floor (case 19)', () => {
      const result = honestDelta(0.1, 0.2, '2020-01-01', {
        hotelCreatedAtLocalDate: '2019-01-01',
        isRatio: true,
        previousDenominator: 3,
      });
      expect('deltaPct' in result).toBe(false);
    });

    it('shows a ratio metric delta at the 5-sample floor (case 20)', () => {
      const result = honestDelta(0.3, 0.2, '2020-01-01', {
        hotelCreatedAtLocalDate: '2019-01-01',
        isRatio: true,
        previousDenominator: 5,
      });
      expect('deltaPct' in result).toBe(true);
      expect(result.deltaPct).toBe(50);
    });

    it('suppresses when dataSinceLocalDate is after the previous window start (case 21)', () => {
      const result = honestDelta(10, 5, '2020-01-01', {
        hotelCreatedAtLocalDate: '2019-01-01',
        dataSinceLocalDate: '2020-06-01',
      });
      expect('deltaPct' in result).toBe(false);
      expect('previous' in result).toBe(false);
    });
  });
});
