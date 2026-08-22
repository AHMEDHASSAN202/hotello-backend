import { GuestLanguage } from '../tenant-stays/stays.constants';

/**
 * Epic 15 — Guest Requests constants. Statuses, cancel reasons and option
 * types are code-versioned unions (same rule as permission/module catalogs).
 */
export const REQUEST_STATUSES = [
  'new',
  'in_progress',
  'done',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Statuses that count against the per-stay open-request throttle. */
export const OPEN_REQUEST_STATUSES: RequestStatus[] = ['new', 'in_progress'];

/** `done` and `cancelled` are final (15.5 AC1). */
export const FINAL_REQUEST_STATUSES: RequestStatus[] = ['done', 'cancelled'];

/**
 * `guest` is reserved for guest-initiated cancellation (15.3 AC3 / 15.5 AC1);
 * staff must pick one of STAFF_CANCEL_REASONS (`other` requires a note).
 */
export const REQUEST_CANCEL_REASONS = [
  'guest',
  'guest_request',
  'not_available',
  'duplicate',
  'other',
] as const;
export type RequestCancelReason = (typeof REQUEST_CANCEL_REASONS)[number];

export const STAFF_CANCEL_REASONS = [
  'guest_request',
  'not_available',
  'duplicate',
  'other',
] as const;
export type StaffCancelReason = (typeof STAFF_CANCEL_REASONS)[number];

/** 15.1 AC3 — one simple option per item: a quantity range or a time picker. */
export const REQUEST_OPTION_TYPES = ['quantity', 'time'] as const;
export type RequestOptionType = (typeof REQUEST_OPTION_TYPES)[number];

/** HH:MM, 24h — same shape the stay checkout time uses. */
export const REQUEST_TIME_OPTION_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Translation JSONB shape (spec note 2): one row carries all languages.
 * Platform rows ship all 7; custom hotel rows require ar+en and fall back to
 * `en` for the rest at guest read time (15.1 AC4) — via localizeField below,
 * the single fallback function.
 */
export type TranslationMap = Partial<Record<GuestLanguage, string>>;

export function localizeField(
  map: TranslationMap | null | undefined,
  language: GuestLanguage,
): string {
  if (!map) return '';
  return map[language] ?? map.en ?? '';
}
