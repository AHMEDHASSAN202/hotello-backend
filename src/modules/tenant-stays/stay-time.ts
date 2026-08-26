/**
 * Hotel-local date/time helpers (Epic 13). Stays use calendar dates in the
 * hotel's timezone; the platform has no timezone library, so local wall-clock
 * is derived through Intl (the same mechanism templates/render.ts uses for
 * formatting). Pure functions — the auto-checkout timezone-edge tests
 * (23:00 vs 01:00 boundaries) run these directly.
 */

export interface HotelLocalParts {
  /** Local calendar date 'YYYY-MM-DD'. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

export function hotelLocalParts(timezone: string, now: Date): HotelLocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  // Some ICU builds render midnight as '24' with hour12: false.
  const hour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + parseInt(parts.minute, 10),
  };
}

/**
 * The UTC instant of the hotel's local midnight for the day containing `now`
 * (Epic 15 — daily request throttle + "done today" board count). Minute
 * precision (sub-minute drift is irrelevant for day-bucket counts).
 */
export function startOfHotelDay(timezone: string, now: Date): Date {
  const { minutes } = hotelLocalParts(timezone, now);
  const subMinute = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - minutes * 60_000 - subMinute);
}

/** 'HH:MM' → minutes since midnight. */
/**
 * Compare-safe parameter for NAIVE `timestamp` columns (TypeORM's
 * created/updatedAt). Those columns hold UTC wall time (DB default now(),
 * session UTC), but the pg driver serializes a JS Date parameter as LOCAL
 * wall time — on a UTC+3 host every `updatedSince` delta ran 3 hours in the
 * future and returned nothing (verified live, Epic 16 bugfix). An ISO string
 * casts to the naive column by dropping the zone suffix, i.e. UTC wall —
 * matching storage regardless of the host timezone. The `as Date` lie keeps
 * TypeORM's FindOperator typing happy; timestamptz columns don't need this.
 */
export function naiveUtc(value: string | Date): Date {
  const iso =
    typeof value === 'string'
      ? new Date(value).toISOString()
      : value.toISOString();
  return iso as unknown as Date;
}

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map((v) => parseInt(v, 10));
  return hours * 60 + minutes;
}

/** Whole days from ISO date `from` to ISO date `to` (negative when past). */
export function daysBetween(from: string, to: string): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * 13.4 AC3 — a stay is overdue once the hotel's local clock passes
 * `checkoutTime` on (or any day after) its check-out date. ISO date strings
 * compare correctly as strings.
 */
export function isStayOverdue(
  checkOutDate: string,
  checkoutTime: string,
  timezone: string,
  now: Date,
): boolean {
  const local = hotelLocalParts(timezone, now);
  if (local.date > checkOutDate) return true;
  if (local.date < checkOutDate) return false;
  return local.minutes >= minutesOf(checkoutTime);
}
