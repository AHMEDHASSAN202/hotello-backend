import { minutesOf } from '../tenant-stays/stay-time';
import { FnbWindow } from './fnb.constants';

/**
 * Availability math in hotel-local wall-clock minutes (16.2 AC1, spec
 * note 2) — pair with `hotelLocalParts(hotel.timezone, now).minutes`. The
 * server is the authority: ordering into a just-closed menu 409s
 * MENU_UNAVAILABLE regardless of what the client rendered.
 */
export interface MenuAvailability {
  available: boolean;
  /** Next opening 'HH:MM' (hotel-local) when closed; null while open. */
  opensAt: string | null;
}

/** Start-inclusive, end-exclusive; start > end spans midnight (20:00–02:00). */
export function isWithinWindow(w: FnbWindow, minutes: number): boolean {
  const start = minutesOf(w.start);
  const end = minutesOf(w.end);
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export function menuAvailability(
  windows: FnbWindow[],
  minutes: number,
): MenuAvailability {
  if (windows.length === 0) return { available: true, opensAt: null };
  if (windows.some((w) => isWithinWindow(w, minutes))) {
    return { available: true, opensAt: null };
  }
  // Next opening: the start with the smallest forward distance (mod 24h).
  const next = windows
    .map((w) => ({
      start: w.start,
      delta: (minutesOf(w.start) - minutes + 1440) % 1440,
    }))
    .sort((a, b) => a.delta - b.delta)[0];
  return { available: false, opensAt: next.start };
}
