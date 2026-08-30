import { TranslationMap } from '../requests/requests.constants';
import { Announcement } from './announcement.entity';
import {
  AnnouncementSource,
  AnnouncementStatus,
  AudienceFilter,
} from './announcements.constants';

/** 19.3 — sent history + detail. Stats are live-computed, never stored. */
export interface TenantAnnouncementView {
  id: string;
  titles: TranslationMap;
  bodies: TranslationMap;
  infoEntryId: string | null;
  priority: boolean;
  audience: AudienceFilter;
  status: AnnouncementStatus;
  publishAtLocal: string | null;
  activeUntilLocal: string | null;
  publishedAt: string | null;
  retractedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Resolved when the audience targets one specific stay. */
  audienceStay: { guestName: string; roomNumber: string } | null;
  /** "قرأه 34 من 62" — reads / currently-matching audience (19.3 AC1). */
  stats: { reads: number; audienceNow: number };
  /** 21.3 groundwork — null = manual; set → tenant UI badges "auto · event". */
  source: AnnouncementSource | null;
}

/** 19.4 — one inbox entry, pre-localized to the stay's language. */
export interface GuestAnnouncementView {
  id: string;
  title: string;
  body: string;
  priority: boolean;
  infoChip: { entryId: string; section: string; name: string } | null;
  /** 21.3 groundwork — resolved the same way as `infoChip`, when set. */
  eventChip: { eventId: string; title: string; startAtLocal: string } | null;
  publishedAt: string | null;
  readAt: string | null;
  active: true;
}

/** Delta rows: a full view, or a tombstone the client must drop. */
export type GuestAnnouncementDelta =
  | GuestAnnouncementView
  | { id: string; active: false };

export interface GuestAnnouncementsFeed {
  data: GuestAnnouncementDelta[];
  /** Over the FULL visible set on every response — the bell badge. */
  unreadCount: number;
  serverTime: string;
}

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

export function toTenantView(
  a: Announcement,
  extras: {
    reads: number;
    audienceNow: number;
    audienceStay: { guestName: string; roomNumber: string } | null;
  },
): TenantAnnouncementView {
  return {
    id: a.id,
    titles: a.titles,
    bodies: a.bodies,
    infoEntryId: a.infoEntryId,
    priority: a.priority,
    audience: a.audience ?? {},
    status: a.status,
    publishAtLocal: a.publishAtLocal,
    activeUntilLocal: a.activeUntilLocal,
    publishedAt: iso(a.publishedAt),
    retractedAt: iso(a.retractedAt),
    expiredAt: iso(a.expiredAt),
    createdAt: iso(a.createdAt) as string,
    updatedAt: iso(a.updatedAt) as string,
    audienceStay: extras.audienceStay,
    stats: { reads: extras.reads, audienceNow: extras.audienceNow },
    source: a.source,
  };
}
