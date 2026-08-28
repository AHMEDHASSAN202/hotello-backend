import { Stay } from '../tenant-stays/stay.entity';
import { hotelLocalParts } from '../tenant-stays/stay-time';
import { Announcement } from './announcement.entity';
import { AudienceFilter } from './announcements.constants';

/**
 * Spec note 2 — visibility resolution in ONE function. `(announcement, stay)
 * → visible?` is answered here and only here; the guest feed, the recipient
 * count preview and the read-stats denominator all call in. Pure — no DI, no
 * clock access (callers pass the hotel-local stamp).
 */

/** Hotel-local wall clock as a lexicographically comparable 'YYYY-MM-DD HH:MM'. */
export function hotelLocalStamp(timezone: string, now: Date): string {
  const { date, minutes } = hotelLocalParts(timezone, now);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

/**
 * 19.1 AC2/AC3 — dynamic audience match. Empty filter = everyone. `stayId`
 * targets exactly one stay (other dimensions ignored); otherwise present
 * dimensions AND together. Floor matching requires the `room` relation.
 */
export function matchesAudience(
  filter: AudienceFilter | null | undefined,
  stay: Stay,
): boolean {
  if (!filter) return true;
  if (filter.stayId) return stay.id === filter.stayId;
  if (filter.stayTypes?.length && !filter.stayTypes.includes(stay.stayType)) {
    return false;
  }
  if (filter.floors?.length) {
    const floor = stay.room?.floor;
    if (floor == null || !filter.floors.includes(floor)) return false;
  }
  if (filter.roomIds?.length && !filter.roomIds.includes(stay.roomId)) {
    return false;
  }
  return true;
}

/**
 * 19.2 AC1 — after `activeUntilLocal` the item leaves guest inboxes entirely.
 * Inclusive at the expiry minute; enforced here as well as by the cron so
 * guests never see an expired item between ticks.
 */
export function isWithinWindow(
  announcement: Pick<Announcement, 'activeUntilLocal'>,
  nowLocal: string,
): boolean {
  return (
    !announcement.activeUntilLocal || announcement.activeUntilLocal > nowLocal
  );
}

export function isVisibleToStay(
  announcement: Announcement,
  stay: Stay,
  nowLocal: string,
): boolean {
  return (
    announcement.status === 'live' &&
    isWithinWindow(announcement, nowLocal) &&
    matchesAudience(announcement.audience, stay)
  );
}
