import { CleaningType, HousekeepingStatus } from './housekeeping.constants';

/**
 * The one transition function (Epic 20, implementation note 2): every state
 * change — board actions, the guest DND toggle, the checkout/vacate hook, and
 * the daily job — goes through here, so the full matrix (incl. DND blocks and
 * parked flags) is testable in one place. Pure; the service persists the
 * returned state and owns side columns (assignment, lastCleanedAt, DND stay).
 */
export interface HkState {
  status: HousekeepingStatus;
  cleaningType: CleaningType | null;
}

export type HkAction =
  /** Manual flag (20.1 AC5) or auto triggers; on a DND room the flag parks (20.4 AC2). */
  | { type: 'flag'; cleaningType: CleaningType }
  /** Manual unflag (20.1 AC5). */
  | { type: 'clear' }
  /** Attendant starts cleaning (20.3 AC2) — blocked on DND rooms. */
  | { type: 'start' }
  /** Cleaning done (20.3 AC2). */
  | { type: 'complete' }
  /** Stopped/interrupted (20.3 AC2) — the reason is kept in audit, not state. */
  | { type: 'interrupt' }
  /** Any vacate (manual/auto checkout, room-change) → checkout clean (20.1 AC3). */
  | { type: 'vacate' }
  /** Guest DND toggle — idempotent both ways (instant apply, 20.4 AC1). */
  | { type: 'dnd_on' }
  | { type: 'dnd_off' };

export type HkErrorCode = 'HOUSEKEEPING_INVALID_STATUS' | 'HOUSEKEEPING_ROOM_DND';

export type HkTransitionResult =
  | { ok: true; state: HkState }
  | { ok: false; code: HkErrorCode };

const ok = (
  status: HousekeepingStatus,
  cleaningType: CleaningType | null,
): HkTransitionResult => ({ ok: true, state: { status, cleaningType } });

const invalid = (): HkTransitionResult => ({
  ok: false,
  code: 'HOUSEKEEPING_INVALID_STATUS',
});

export function transition(state: HkState, action: HkAction): HkTransitionResult {
  const { status, cleaningType } = state;
  switch (action.type) {
    case 'flag':
      // In-progress rooms must be interrupted first — someone is in there.
      if (status === 'in_progress') return invalid();
      // A DND room keeps its parked flag under DND until released (20.4 AC2).
      if (status === 'dnd') return ok('dnd', action.cleaningType);
      return ok('needs_cleaning', action.cleaningType);
    case 'clear':
      if (status === 'needs_cleaning') return ok('clean', null);
      if (status === 'dnd' && cleaningType !== null) return ok('dnd', null);
      return invalid();
    case 'start':
      if (status === 'dnd') return { ok: false, code: 'HOUSEKEEPING_ROOM_DND' };
      if (status !== 'needs_cleaning') return invalid();
      return ok('in_progress', cleaningType);
    case 'complete':
      if (status !== 'in_progress') return invalid();
      return ok('clean', null);
    case 'interrupt':
      if (status !== 'in_progress') return invalid();
      return ok('needs_cleaning', cleaningType);
    case 'vacate':
      // The vacated room always needs the deeper turnover clean, whatever
      // state it was in — DND dies with the stay (20.4 AC3).
      return ok('needs_cleaning', 'checkout');
    case 'dnd_on':
      // From in_progress this is interrupted-by-guest: the kept cleaningType
      // returns the room to needs_cleaning on release (recorded decision).
      return ok('dnd', cleaningType);
    case 'dnd_off':
      if (status !== 'dnd') return ok(status, cleaningType);
      return ok(cleaningType !== null ? 'needs_cleaning' : 'clean', cleaningType);
  }
}
