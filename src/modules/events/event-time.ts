import { hotelLocalParts } from '../tenant-stays/stay-time';

/**
 * Epic 21 — pure hotel-local time arithmetic on the 'YYYY-MM-DD HH:MM' stamp
 * convention (`Event.startAtLocal`/`endAtLocal`, the Announcements
 * `publishAtLocal` precedent). Never converts to a real UTC instant — the
 * stamp is parsed and re-formatted as plain calendar/clock arithmetic (a
 * `Date.UTC` epoch is used only as scratch space for the +/- minutes math,
 * never compared against wall-clock `now`), so it stays correct regardless
 * of the host process's timezone.
 */

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * Hotel-local wall clock as a lexicographically comparable 'YYYY-MM-DD
 * HH:MM' — the same shape `startAtLocal`/`endAtLocal` use, so `list()`'s
 * "upcoming" tab can string-compare `now` against them directly (the
 * `isStayOverdue`/Announcements `hotelLocalStamp` precedent, kept local to
 * this module instead of importing across the Announcements domain).
 */
export function hotelLocalStamp(timezone: string, now: Date): string {
  const { date, minutes } = hotelLocalParts(timezone, now);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

export function addMinutesLocal(stamp: string, minutes: number): string {
  const match = STAMP_RE.exec(stamp);
  if (!match) {
    throw new Error(`Invalid hotel-local stamp: ${stamp}`);
  }
  const [, year, month, day, hour, minute] = match;
  const epoch = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute) + minutes,
  );
  const result = new Date(epoch);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())} ` +
    `${pad(result.getUTCHours())}:${pad(result.getUTCMinutes())}`
  );
}
