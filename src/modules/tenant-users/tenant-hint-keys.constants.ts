/**
 * Epic 12, Story 12.4 — the closed set of dismissible first-run hints.
 *
 * Mirrors the permission-catalog pattern: code is the single source of truth.
 * The dismiss endpoint rejects unknown keys, so `tenant_users.dismissedHints`
 * can never grow beyond this list. Future epics append their keys here
 * (e.g. `rooms.firstRun` in Epic 11/13+).
 */
export const TENANT_HINT_KEYS = [
  'staff.firstRun',
  'roles.firstRun',
  'home.setupSteps',
  'rooms.firstRun',
  'stays.firstRun',
] as const;

export type TenantHintKey = (typeof TENANT_HINT_KEYS)[number];

export function isTenantHintKey(key: string): key is TenantHintKey {
  return (TENANT_HINT_KEYS as readonly string[]).includes(key);
}
