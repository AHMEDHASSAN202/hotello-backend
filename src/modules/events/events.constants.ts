import { RenditionPreset } from '../renditions/rendition.interface';
import { TranslationMap } from '../requests/requests.constants';

/**
 * Epic 21 — Events & Workshops constants. Statuses and the photo preset are
 * the single source of truth for the event lifecycle and its image
 * pipeline (Story 21.1 AC1's shared rendition service), mirroring the F&B
 * constants shape (`fnb.constants.ts`).
 */
export const EVENT_STATUSES = ['draft', 'published', 'completed', 'cancelled'] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_BOOKING_STATUSES = ['booked', 'cancelled'] as const;

export type EventBookingStatus = (typeof EVENT_BOOKING_STATUSES)[number];

/** Who cancelled a booking — 'guest' is guest-initiated, mirrors F&B's cancel-reason split. */
export const EVENT_BOOKING_CANCELLED_BY = ['guest', 'staff', 'system'] as const;

export type EventBookingCancelledBy = (typeof EVENT_BOOKING_CANCELLED_BY)[number];

/** Event photo renditions, storage keys (never URLs) — same shape as `FnbPhotoKeys`. */
export interface EventPhotoKeys {
  thumb: string;
  detail: string;
}

/** Reuses the F&B numbers (Story 21.1 AC1 — one shared rendition service, per-feature presets). */
export const EVENTS_PHOTO_PRESET: RenditionPreset = {
  thumb: { width: 480, height: 360, fit: 'cover', quality: 80 },
  detail: { width: 1200, height: 1200, fit: 'inside', quality: 82, withoutEnlargement: true },
};

/**
 * What a booking snapshots at creation time (event edits must never rewrite
 * this — the F&B order-line snapshot precedent).
 */
export interface EventBookingSnapshot {
  titles: TranslationMap;
  startAtLocal: string;
  endAtLocal: string | null;
  locationText: string;
}

export const EVENT_BOOKING_MAX_PARTY_SIZE = 6;
