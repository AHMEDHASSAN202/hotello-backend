import { BadRequestException } from '@nestjs/common';
import { StayType, STAY_TYPES } from '../tenant-stays/stays.constants';
import { FnbVariant } from './fnb.constants';
import { PricingItem, resolvePrice } from './fnb-pricing';

const variant: FnbVariant = {
  label: { en: 'Size', ar: 'الحجم' },
  options: [
    { key: 'medium', names: { en: 'Medium', ar: 'وسط' }, price: 80 },
    { key: 'large', names: { en: 'Large', ar: 'كبير' }, price: 110 },
  ],
};

const item = (o: Partial<PricingItem> = {}): PricingItem => ({
  price: 50,
  includedFor: null,
  variant: null,
  ...o,
});

describe('resolvePrice — THE pricing function (16.2 AC3/AC4, spec note 3)', () => {
  describe('matrix: stay types × pricing modes', () => {
    // includedFor null = inherit menu default; [] = always-paid override.
    const menuDefault: StayType[] = ['all_inclusive'];

    it.each(STAY_TYPES.map((t) => [t]))(
      'inherit + AI menu default — %s',
      (stayType) => {
        const res = resolvePrice(item(), menuDefault, null, stayType);
        if (stayType === 'all_inclusive') {
          expect(res).toEqual({ included: true, unitPrice: 0 });
        } else {
          expect(res).toEqual({ included: false, unitPrice: 50 });
        }
      },
    );

    it.each(STAY_TYPES.map((t) => [t]))(
      'always-paid override ([]) beats the menu default — %s',
      (stayType) => {
        expect(
          resolvePrice(item({ includedFor: [] }), menuDefault, null, stayType),
        ).toEqual({ included: false, unitPrice: 50 });
      },
    );

    it.each(STAY_TYPES.map((t) => [t]))(
      'explicit included_for [all_inclusive, half_board] — %s',
      (stayType) => {
        const res = resolvePrice(
          item({ includedFor: ['all_inclusive', 'half_board'] }),
          [],
          null,
          stayType,
        );
        const covered =
          stayType === 'all_inclusive' || stayType === 'half_board';
        expect(res.included).toBe(covered);
        expect(res.unitPrice).toBe(covered ? 0 : 50);
      },
    );
  });

  describe('variants (16.2 AC4)', () => {
    it('a variant option carries its own absolute price', () => {
      expect(
        resolvePrice(item({ variant }), [], 'large', 'room_only'),
      ).toEqual({ included: false, unitPrice: 110 });
      expect(
        resolvePrice(item({ variant }), [], 'medium', 'room_only'),
      ).toEqual({ included: false, unitPrice: 80 });
    });

    it('an included item with variants is still 0 for a covered stay type', () => {
      expect(
        resolvePrice(
          item({ variant, includedFor: ['all_inclusive'] }),
          [],
          'large',
          'all_inclusive',
        ),
      ).toEqual({ included: true, unitPrice: 0 });
    });

    it('unknown option key → FNB_VARIANT_INVALID', () => {
      expect(() =>
        resolvePrice(item({ variant }), [], 'xl', 'room_only'),
      ).toThrow(BadRequestException);
    });

    it('missing option key on a variant item → FNB_VARIANT_INVALID', () => {
      expect(() =>
        resolvePrice(item({ variant }), [], null, 'room_only'),
      ).toThrow(BadRequestException);
    });

    it('an option key on a variant-less item → FNB_VARIANT_INVALID', () => {
      expect(() => resolvePrice(item(), [], 'medium', 'room_only')).toThrow(
        BadRequestException,
      );
    });
  });
});
