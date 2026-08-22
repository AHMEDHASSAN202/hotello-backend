import { BadRequestException } from '@nestjs/common';
import { StayType } from '../tenant-stays/stays.constants';
import { FnbVariant } from './fnb.constants';

/**
 * THE pricing resolution (spec note 3) — the single function behind guest
 * render, cart totals and order creation. The server recomputes with it on
 * every order; client totals are display-only.
 *
 * `includedFor` semantics (recorded decision): null = inherit the menu's
 * default; [] = always paid (the per-item override); non-empty = included for
 * exactly those stay types. An included item is 0 even through a variant
 * (16.2 AC4 — the price shows only when the stay type doesn't cover it).
 */
export interface PricingItem {
  price: number;
  includedFor: StayType[] | null;
  variant: FnbVariant | null;
}

export interface PricingResult {
  included: boolean;
  unitPrice: number;
}

export function resolvePrice(
  item: PricingItem,
  menuDefaultIncludedFor: StayType[],
  variantKey: string | null,
  stayType: StayType,
): PricingResult {
  const includedFor = item.includedFor ?? menuDefaultIncludedFor;
  const included = includedFor.includes(stayType);

  let base = item.price;
  if (item.variant) {
    const option = item.variant.options.find((o) => o.key === variantKey);
    if (!option) {
      throw new BadRequestException({
        code: 'FNB_VARIANT_INVALID',
        message: 'Choose a valid option for this item',
      });
    }
    base = option.price;
  } else if (variantKey) {
    throw new BadRequestException({
      code: 'FNB_VARIANT_INVALID',
      message: 'This item has no options',
    });
  }

  return { included, unitPrice: included ? 0 : base };
}
