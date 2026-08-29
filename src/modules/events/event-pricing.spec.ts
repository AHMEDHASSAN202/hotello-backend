import { STAY_TYPES, StayType } from '../tenant-stays/stays.constants';
import { resolveEventPrice } from './event-pricing';

describe('resolveEventPrice (Story 21.2/21.3 pricing)', () => {
  it('a free event is always paid=0 and not "included", whatever the stay type', () => {
    const freeEvent = { price: 0, includedFor: [] };
    for (const stayType of STAY_TYPES) {
      // A free event still has includedFor: [] — "included" only reflects
      // the two-state includedFor flag, not the price itself.
      expect(resolveEventPrice(freeEvent, stayType, 2)).toEqual({
        included: false,
        unitPrice: 0,
        total: 0,
      });
    }
  });

  it('a paid event with includedFor: [] is paid for every stay type', () => {
    const event = { price: 50, includedFor: [] };
    for (const stayType of STAY_TYPES) {
      expect(resolveEventPrice(event, stayType, 1)).toEqual({
        included: false,
        unitPrice: 50,
        total: 50,
      });
    }
  });

  it("a paid event with includedFor: ['all_inclusive'] is included only for that stay type", () => {
    const event = { price: 50, includedFor: ['all_inclusive'] as StayType[] };
    expect(resolveEventPrice(event, 'all_inclusive', 3)).toEqual({
      included: true,
      unitPrice: 0,
      total: 0,
    });
    for (const stayType of STAY_TYPES.filter((t) => t !== 'all_inclusive')) {
      expect(resolveEventPrice(event, stayType, 3)).toEqual({
        included: false,
        unitPrice: 50,
        total: 150,
      });
    }
  });

  it('total = unitPrice × partySize across party sizes 1–6', () => {
    const event = { price: 20, includedFor: [] };
    for (let partySize = 1; partySize <= 6; partySize += 1) {
      expect(resolveEventPrice(event, 'room_only', partySize)).toEqual({
        included: false,
        unitPrice: 20,
        total: 20 * partySize,
      });
    }
  });
});
