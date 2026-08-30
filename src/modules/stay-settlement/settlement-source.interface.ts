/**
 * Story 21.6 AC2 — the shared abstraction both F&B and event-booking
 * settlement plug into so `StaySettlementService` can produce ONE combined
 * unsettled total / ONE settle action for a stay, without either domain
 * forking the other's logic. Each module owns exactly one `SettlementSource`
 * implementation (`FnbSettlementSource`, `EventSettlementSource`); nothing
 * else may re-implement "which of this module's records are unsettled" or
 * "mark them settled" — that stays the sole responsibility of the source.
 */
export const SETTLEMENT_SOURCES = Symbol('SETTLEMENT_SOURCES');

/** One unsettled record, reduced to what settlement math needs. */
export interface UnsettledLine {
  id: string;
  totalAmount: number;
}

export interface SettlementSource {
  /** Stable identifier for the per-source breakdown (`byKey`), e.g. 'fnb'. */
  readonly key: string;

  /** Unsettled lines for this stay, this source only — no rounding/summing. */
  findUnsettled(hotelId: string, stayId: string): Promise<UnsettledLine[]>;

  /**
   * Marks every currently-unsettled line for this stay as settled and
   * returns the lines that were just settled (empty when there was nothing
   * to settle — idempotent).
   */
  markSettled(
    hotelId: string,
    stayId: string,
    settledById: string,
  ): Promise<UnsettledLine[]>;
}
