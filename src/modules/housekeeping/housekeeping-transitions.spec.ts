import {
  HkState,
  HkTransitionResult,
  transition,
} from './housekeeping-transitions';

/**
 * Exhaustive transition matrix (Epic 20, implementation note 2): every
 * action against every status, including the parked-flag DND states.
 */
const clean: HkState = { status: 'clean', cleaningType: null };
const needsCheckout: HkState = { status: 'needs_cleaning', cleaningType: 'checkout' };
const needsDaily: HkState = { status: 'needs_cleaning', cleaningType: 'daily' };
const inProgress: HkState = { status: 'in_progress', cleaningType: 'daily' };
const dndBare: HkState = { status: 'dnd', cleaningType: null };
const dndParked: HkState = { status: 'dnd', cleaningType: 'daily' };

const expectState = (result: HkTransitionResult, state: HkState) => {
  expect(result).toEqual({ ok: true, state });
};

const expectError = (result: HkTransitionResult, code: string) => {
  expect(result).toEqual({ ok: false, code });
};

describe('housekeeping transition matrix (20.1–20.4)', () => {
  describe('flag (20.1 AC2/AC5)', () => {
    it('flags a clean room with the given type', () => {
      expectState(transition(clean, { type: 'flag', cleaningType: 'daily' }), {
        status: 'needs_cleaning',
        cleaningType: 'daily',
      });
    });

    it('re-flags a flagged room, switching the type', () => {
      expectState(transition(needsDaily, { type: 'flag', cleaningType: 'checkout' }), {
        status: 'needs_cleaning',
        cleaningType: 'checkout',
      });
    });

    it('rejects flagging an in_progress room', () => {
      expectError(
        transition(inProgress, { type: 'flag', cleaningType: 'checkout' }),
        'HOUSEKEEPING_INVALID_STATUS',
      );
    });

    it('parks the flag on a DND room (20.4 AC2)', () => {
      expectState(transition(dndBare, { type: 'flag', cleaningType: 'checkout' }), {
        status: 'dnd',
        cleaningType: 'checkout',
      });
    });
  });

  describe('clear (20.1 AC5)', () => {
    it('clears a flagged room back to clean', () => {
      expectState(transition(needsCheckout, { type: 'clear' }), {
        status: 'clean',
        cleaningType: null,
      });
    });

    it('clears the parked flag of a DND room without releasing DND', () => {
      expectState(transition(dndParked, { type: 'clear' }), {
        status: 'dnd',
        cleaningType: null,
      });
    });

    it.each([clean, inProgress, dndBare])(
      'rejects clearing when there is no flag (%o)',
      (state) => {
        expectError(transition(state, { type: 'clear' }), 'HOUSEKEEPING_INVALID_STATUS');
      },
    );
  });

  describe('start (20.3 AC2)', () => {
    it('starts a flagged room, keeping the cleaning type', () => {
      expectState(transition(needsCheckout, { type: 'start' }), {
        status: 'in_progress',
        cleaningType: 'checkout',
      });
    });

    it.each([dndBare, dndParked])(
      'blocks starting a DND room with its own code (%o)',
      (state) => {
        expectError(transition(state, { type: 'start' }), 'HOUSEKEEPING_ROOM_DND');
      },
    );

    it.each([clean, inProgress])('rejects starting from %o', (state) => {
      expectError(transition(state, { type: 'start' }), 'HOUSEKEEPING_INVALID_STATUS');
    });
  });

  describe('complete (20.3 AC2)', () => {
    it('completes an in_progress room to clean with no flag', () => {
      expectState(transition(inProgress, { type: 'complete' }), {
        status: 'clean',
        cleaningType: null,
      });
    });

    it.each([clean, needsDaily, dndBare, dndParked])(
      'rejects completing from %o',
      (state) => {
        expectError(transition(state, { type: 'complete' }), 'HOUSEKEEPING_INVALID_STATUS');
      },
    );
  });

  describe('interrupt (20.3 AC2)', () => {
    it('returns an in_progress room to needs_cleaning, keeping the type', () => {
      expectState(transition(inProgress, { type: 'interrupt' }), {
        status: 'needs_cleaning',
        cleaningType: 'daily',
      });
    });

    it.each([clean, needsCheckout, dndBare, dndParked])(
      'rejects interrupting from %o',
      (state) => {
        expectError(transition(state, { type: 'interrupt' }), 'HOUSEKEEPING_INVALID_STATUS');
      },
    );
  });

  describe('vacate (20.1 AC3)', () => {
    it.each([clean, needsDaily, inProgress, dndBare, dndParked])(
      'always lands on needs_cleaning (checkout) from %o',
      (state) => {
        expectState(transition(state, { type: 'vacate' }), {
          status: 'needs_cleaning',
          cleaningType: 'checkout',
        });
      },
    );
  });

  describe('dnd_on (20.4 AC1/AC2)', () => {
    it('sets DND on a clean room', () => {
      expectState(transition(clean, { type: 'dnd_on' }), {
        status: 'dnd',
        cleaningType: null,
      });
    });

    it('parks the existing flag when a flagged room goes DND', () => {
      expectState(transition(needsCheckout, { type: 'dnd_on' }), {
        status: 'dnd',
        cleaningType: 'checkout',
      });
    });

    it('treats DND during cleaning as interrupted-by-guest (keeps the type)', () => {
      expectState(transition(inProgress, { type: 'dnd_on' }), {
        status: 'dnd',
        cleaningType: 'daily',
      });
    });

    it('is idempotent on an already-DND room', () => {
      expectState(transition(dndParked, { type: 'dnd_on' }), dndParked);
    });
  });

  describe('dnd_off (20.4 AC3)', () => {
    it('releases a bare DND room to clean', () => {
      expectState(transition(dndBare, { type: 'dnd_off' }), clean);
    });

    it('releases a parked flag back to needs_cleaning (20.4 AC2)', () => {
      expectState(transition(dndParked, { type: 'dnd_off' }), {
        status: 'needs_cleaning',
        cleaningType: 'daily',
      });
    });

    it.each([clean, needsCheckout, inProgress])(
      'is a no-op on a non-DND room (%o)',
      (state) => {
        expectState(transition(state, { type: 'dnd_off' }), state);
      },
    );
  });
});
