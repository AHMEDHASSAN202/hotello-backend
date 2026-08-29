import { StayType } from '../tenant-stays/stays.constants';

/**
 * Epic 21 — Story 21.2/21.3 pricing resolution, one function for both the
 * booking-detail preview and the actual booking write (the F&B order-line
 * precedent: compute once, reuse everywhere). `includedFor` is two-state
 * (Event entity doc): `[]` = paid for every stay type, non-empty = included
 * only for those stay types — there is no "inherit" third state here.
 */
export function resolveEventPrice(
  event: { price: number; includedFor: StayType[] },
  stayType: StayType,
  partySize: number,
): { included: boolean; unitPrice: number; total: number } {
  const included = event.includedFor.includes(stayType);
  const unitPrice = included ? 0 : event.price;
  return { included, unitPrice, total: unitPrice * partySize };
}
