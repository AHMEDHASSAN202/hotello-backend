/**
 * Housekeeping cleanliness axis (Epic 20, Story 20.1 AC1) — fully independent
 * from `rooms.status` (operational axis). Current-state-only model: history
 * lives in the audit trail, not a tasks table. Single source of truth for the
 * status/type unions — the tenant board, guest DND toggle, and daily job all
 * import from here.
 */
export const HOUSEKEEPING_STATUSES = [
  'clean',
  'needs_cleaning',
  'in_progress',
  'dnd',
] as const;

export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];

/**
 * Why a room needs cleaning (20.1 AC2): `checkout` = deeper turnover clean
 * (sorted first within a floor on the board), `daily` = stay-over service.
 */
export const CLEANING_TYPES = ['checkout', 'daily'] as const;

export type CleaningType = (typeof CLEANING_TYPES)[number];

/** Hotel-local daily service hour default (20.1 AC4), stored as 'HH:MM'. */
export const DEFAULT_DAILY_SERVICE_TIME = '09:00';
