/**
 * Guest-facing languages (Epic 13, Story 13.1 AC1). The Guest App will later
 * localize into all seven; emails cover ar/en today and fall back to en
 * (Story 13.4 AC4 via resolveGuestEmailLanguage). Single source of truth —
 * repo law: never hardcode this list in more than one place per repo.
 */
export const GUEST_LANGUAGES = [
  'ar',
  'en',
  'ru',
  'fr',
  'it',
  'es',
  'de',
] as const;

export type GuestLanguage = (typeof GUEST_LANGUAGES)[number];

/** Stays are permanent records — `checked_out` is final (13.4 AC4). */
export type StayStatus = 'active' | 'checked_out';

/**
 * Board basis of a stay (Epic 16, Story 16.1 AC1) — drives F&B menu pricing:
 * items "included for" the guest's stay type render ✓Included at price 0.
 */
export const STAY_TYPES = [
  'all_inclusive',
  'half_board',
  'bed_breakfast',
  'room_only',
] as const;

export type StayType = (typeof STAY_TYPES)[number];

/** City-hotel default; resorts flip the hotel setting to all_inclusive (16.1 AC2). */
export const DEFAULT_STAY_TYPE: StayType = 'room_only';

export type CheckoutType = 'manual' | 'automatic';

/** Hotel-local checkout hour default (13.4 AC2), stored as 'HH:MM'. */
export const DEFAULT_CHECKOUT_TIME = '12:00';

export const CHECKOUT_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Stay codes are exactly six digits (13.1 AC3). */
export const STAY_CODE_LENGTH = 6;
export const STAY_CODE_REGEX = /^\d{6}$/;
