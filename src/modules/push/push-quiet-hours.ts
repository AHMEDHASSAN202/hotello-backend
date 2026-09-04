import { hotelLocalParts, minutesOf } from '../tenant-stays/stay-time';

/**
 * 23.3 AC4 — if `now` falls inside the hotel-local quiet window, return the UTC
 * instant of the window's end (delivery resumes there); else null. The window
 * may cross midnight (default 22:00→08:00). start === end = window disabled.
 */
export function quietHold(
  timezone: string,
  now: Date,
  start: string,
  end: string,
): Date | null {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return null;
  const { minutes } = hotelLocalParts(timezone, now);
  const inWindow = s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
  if (!inWindow) return null;
  const untilEnd = (e - minutes + 1440) % 1440;
  return new Date(now.getTime() + untilEnd * 60_000);
}
