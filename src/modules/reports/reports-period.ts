/**
 * Pure period-resolution helpers for Reports & Analytics (Epic 22, Story 22.1
 * AC1/AC6). No NestJS decorators, no I/O, no repositories — plain functions
 * over primitives and `Date`, built on top of the Epic 13 hotel-local-time
 * helpers in `tenant-stays/stay-time.ts` (do not reimplement that math here).
 */

import { daysBetween, hotelLocalParts } from '../tenant-stays/stay-time';

export const REPORT_PRESETS = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'custom',
] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export interface ResolvedPeriod {
  /** hotel-local 'YYYY-MM-DD', inclusive */
  fromDate: string;
  /** hotel-local 'YYYY-MM-DD', inclusive */
  toDate: string;
  /** UTC instant of fromDate's local midnight */
  fromUtc: Date;
  /** UTC instant of the local midnight AFTER toDate (exclusive upper bound) */
  toUtcExclusive: Date;
  /** inclusive day count, e.g. today = 1 */
  days: number;
  /** true when toDate === the hotel's current local date */
  endsToday: boolean;
}

export interface PeriodInput {
  preset: ReportPreset;
  /** 'YYYY-MM-DD', required + validated only when preset === 'custom' */
  from?: string;
  /** 'YYYY-MM-DD', required + validated only when preset === 'custom' */
  to?: string;
}

export class ReportPeriodError extends Error {
  constructor(
    public readonly code: 'REPORT_RANGE_TOO_LARGE' | 'REPORT_RANGE_INVALID',
    message: string,
  ) {
    super(message);
  }
}

const MAX_CUSTOM_RANGE_DAYS = 366;

/** Plain 'YYYY-MM-DD' string arithmetic — no calendar library needed. */
function shiftLocalDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The UTC instant of local midnight on `dateStr` in `timezone`.
 *
 * Guess `dateStr`'s midnight as if it were UTC, read back what that instant's
 * local date/time actually is, and correct the guess by the resulting offset
 * (accounting for any day rollover, not just minutes). A correction can
 * itself cross a DST transition, so the read-back-and-correct step runs
 * twice — a deliberate, tested bound, not a convergence loop.
 */
export function utcInstantOfLocalMidnight(
  timezone: string,
  dateStr: string,
): Date {
  let guess = new Date(`${dateStr}T00:00:00Z`);
  for (let pass = 0; pass < 2; pass++) {
    const parts = hotelLocalParts(timezone, guess);
    const dayOffset = daysBetween(dateStr, parts.date);
    const offsetMinutes = dayOffset * 1440 + parts.minutes;
    guess = new Date(guess.getTime() - offsetMinutes * 60_000);
  }
  return guess;
}

/**
 * Turn a preset or custom range into hotel-local boundaries plus their UTC
 * instants. See the task brief / epic spec (Story 22.1 AC1) for the exact
 * per-preset rules and custom-range guards.
 */
export function resolvePeriod(
  timezone: string,
  now: Date,
  input: PeriodInput,
): ResolvedPeriod {
  const currentLocalDate = hotelLocalParts(timezone, now).date;

  let fromDate: string;
  let toDate: string;

  switch (input.preset) {
    case 'today':
      fromDate = currentLocalDate;
      toDate = currentLocalDate;
      break;
    case 'yesterday':
      fromDate = shiftLocalDate(currentLocalDate, -1);
      toDate = fromDate;
      break;
    case 'last7':
      fromDate = shiftLocalDate(currentLocalDate, -6);
      toDate = currentLocalDate;
      break;
    case 'last30':
      fromDate = shiftLocalDate(currentLocalDate, -29);
      toDate = currentLocalDate;
      break;
    case 'custom': {
      if (!input.from || !input.to) {
        throw new ReportPeriodError(
          'REPORT_RANGE_INVALID',
          'Custom report ranges require both `from` and `to`.',
        );
      }
      fromDate = input.from;
      // Never throw for a future `to` — clamp it down to today instead.
      toDate = input.to > currentLocalDate ? currentLocalDate : input.to;
      if (fromDate > toDate) {
        throw new ReportPeriodError(
          'REPORT_RANGE_INVALID',
          '`from` must not be after `to`.',
        );
      }
      if (daysBetween(fromDate, toDate) + 1 > MAX_CUSTOM_RANGE_DAYS) {
        throw new ReportPeriodError(
          'REPORT_RANGE_TOO_LARGE',
          `Custom report ranges cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days.`,
        );
      }
      break;
    }
    default: {
      const exhaustive: never = input.preset;
      throw new ReportPeriodError(
        'REPORT_RANGE_INVALID',
        `Unknown report preset: ${String(exhaustive)}`,
      );
    }
  }

  const days = daysBetween(fromDate, toDate) + 1;
  const endsToday = toDate === currentLocalDate;
  const fromUtc = utcInstantOfLocalMidnight(timezone, fromDate);
  const toUtcExclusive = utcInstantOfLocalMidnight(
    timezone,
    shiftLocalDate(toDate, 1),
  );

  return { fromDate, toDate, fromUtc, toUtcExclusive, days, endsToday };
}

export interface PreviousWindow {
  /** hotel-local 'YYYY-MM-DD' */
  from: string;
  /** hotel-local 'YYYY-MM-DD' */
  to: string;
  fromUtc: Date;
  /** see partial-window note on `previousWindow` */
  toUtcExclusive: Date;
  partial: boolean;
}

/**
 * The immediately preceding window of identical calendar length, for "vs
 * previous period" comparisons. When `period` ends today (still mid-day),
 * the previous window is capped at the same elapsed minute-of-day so the
 * comparison isn't skewed by comparing a full day to a partial one.
 */
export function previousWindow(
  period: ResolvedPeriod,
  timezone: string,
  now: Date,
): PreviousWindow {
  const prevTo = shiftLocalDate(period.fromDate, -1);
  const prevFrom = shiftLocalDate(prevTo, -(period.days - 1));
  const fromUtc = utcInstantOfLocalMidnight(timezone, prevFrom);

  if (!period.endsToday) {
    const toUtcExclusive = utcInstantOfLocalMidnight(
      timezone,
      shiftLocalDate(prevTo, 1),
    );
    return { from: prevFrom, to: prevTo, fromUtc, toUtcExclusive, partial: false };
  }

  const minutesElapsedToday = hotelLocalParts(timezone, now).minutes;
  const prevToMidnight = utcInstantOfLocalMidnight(timezone, prevTo);
  const toUtcExclusive = new Date(
    prevToMidnight.getTime() + minutesElapsedToday * 60_000,
  );
  return { from: prevFrom, to: prevTo, fromUtc, toUtcExclusive, partial: true };
}

export interface HonestDeltaOptions {
  /** 'YYYY-MM-DD' — the hotel's creation date in its own local timezone */
  hotelCreatedAtLocalDate: string;
  /** true for percentage/rate metrics (SLA breach rate, avg completion) */
  isRatio?: boolean;
  /** required and used only when isRatio is true */
  previousDenominator?: number;
  /** optional — for audit/event-sourced metrics with a known start date */
  dataSinceLocalDate?: string;
}

export interface MetricWithDelta {
  value: number;
  deltaPct?: number;
  previous?: number;
}

const MIN_RATIO_SAMPLE_SIZE = 5;

/**
 * Decide whether a "vs previous period" comparison is honest enough to show
 * (Story 22.1 AC6): render nothing rather than a misleading arrow when the
 * previous period doesn't have enough data. See the task brief for the four
 * suppression rules. The returned object never carries a `deltaPct`/`previous`
 * key with an explicit `undefined` value — the keys are simply absent when
 * suppressed.
 */
export function honestDelta(
  current: number,
  previous: number,
  previousWindowFrom: string,
  opts: HonestDeltaOptions,
): MetricWithDelta {
  const hotelDidNotExistForWholeWindow =
    previousWindowFrom < opts.hotelCreatedAtLocalDate;
  const dataDidNotExistForWholeWindow =
    opts.dataSinceLocalDate !== undefined &&
    previousWindowFrom < opts.dataSinceLocalDate;
  const countMetricHasNoBaseline = !opts.isRatio && previous <= 0;
  const ratioSampleTooSmall =
    !!opts.isRatio && (opts.previousDenominator ?? 0) < MIN_RATIO_SAMPLE_SIZE;

  if (
    hotelDidNotExistForWholeWindow ||
    dataDidNotExistForWholeWindow ||
    countMetricHasNoBaseline ||
    ratioSampleTooSmall
  ) {
    return { value: current };
  }

  const rawDeltaPct = ((current - previous) / previous) * 100;
  const deltaPct = Math.round(rawDeltaPct * 10) / 10;
  return { value: current, previous, deltaPct };
}
