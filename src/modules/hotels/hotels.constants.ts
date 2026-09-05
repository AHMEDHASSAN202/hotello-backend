/**
 * Slug rules (Story 5.3 AC3): lowercase kebab-case, 3–40 chars, no leading or
 * trailing hyphen. The slug drives the tenant URLs, so it is immutable after
 * creation except by Super Admin (*), and every change is audit-logged.
 */
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Slugs that would collide with platform subdomains or routes. */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'app',
  'www',
  'guest',
  'mail',
  'dashboard',
  'portal',
  'auth',
  'login',
  'static',
  'assets',
  'cdn',
  'docs',
  'help',
  'support',
  'status',
  'staging',
  'dev',
  'test',
  'tenant',
  'gxp',
] as const;

export const HOTEL_STATUSES = ['active', 'suspended', 'inactive'] as const;
export type HotelStatus = (typeof HOTEL_STATUSES)[number];

export const SUSPENSION_REASONS = [
  'non_payment',
  'policy_violation',
  'hotel_request',
  'other',
] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

export const HOTEL_SORT_FIELDS = ['name', 'createdAt', 'plan'] as const;
export type HotelSortField = (typeof HOTEL_SORT_FIELDS)[number];

/** Logo upload constraints (Story 5.3 AC2 / implementation note 10). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
