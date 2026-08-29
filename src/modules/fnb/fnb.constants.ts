import { TranslationMap } from '../requests/requests.constants';
import { RenditionPreset } from '../renditions/rendition.interface';

/**
 * Epic 16 — F&B ordering constants. Statuses, transitions and cancel reasons
 * are the single source of truth for the order lifecycle (16.6 AC1, 16.7 AC2);
 * the transition map is enforced server-side, mirrored by both UIs.
 */
export const FNB_ORDER_STATUSES = [
  'new',
  'preparing',
  'on_the_way',
  'delivered',
  'cancelled',
] as const;

export type FnbOrderStatus = (typeof FNB_ORDER_STATUSES)[number];

export const OPEN_FNB_ORDER_STATUSES: FnbOrderStatus[] = [
  'new',
  'preparing',
  'on_the_way',
];

export const FINAL_FNB_ORDER_STATUSES: FnbOrderStatus[] = [
  'delivered',
  'cancelled',
];

/**
 * Staff transitions (16.7 AC2): Start → preparing, Out for delivery,
 * Delivered; staff cancel only from new/preparing. Guest cancel is stricter —
 * `new` only (16.6 AC2) — and checked separately.
 */
export const FNB_ORDER_TRANSITIONS: Record<FnbOrderStatus, FnbOrderStatus[]> = {
  new: ['preparing', 'cancelled'],
  preparing: ['on_the_way', 'cancelled'],
  on_the_way: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const FNB_CANCEL_REASONS = [
  'guest',
  'out_of_stock',
  'kitchen_closed',
  'guest_request',
  'other',
] as const;

export type FnbCancelReason = (typeof FNB_CANCEL_REASONS)[number];

/** What the staff cancel dialog offers (16.7 AC2); 'guest' is guest-initiated. */
export const STAFF_FNB_CANCEL_REASONS: FnbCancelReason[] = [
  'out_of_stock',
  'kitchen_closed',
  'guest_request',
  'other',
];

/** 16.4 AC1 — cash is always on; room charge is the only opt-in. */
export const FNB_PAYMENT_METHODS = ['cash', 'room_charge'] as const;

export type FnbPaymentMethod = (typeof FNB_PAYMENT_METHODS)[number];

export const FNB_DESTINATION_TYPES = ['room', 'location'] as const;

export type FnbDestinationType = (typeof FNB_DESTINATION_TYPES)[number];

/** One simple variant group per item (16.2 AC4) — no multi-group modifiers. */
export interface FnbVariantOption {
  /** Stable slug key — order lines snapshot it (16.5 AC4). */
  key: string;
  names: TranslationMap;
  /** Absolute price, not a delta ("Medium 80 / Large 110"). */
  price: number;
}

export interface FnbVariant {
  label: TranslationMap;
  options: FnbVariantOption[];
}

/** Availability window in hotel-local wall-clock 'HH:MM' (16.2 AC1). */
export interface FnbWindow {
  start: string;
  end: string;
}

/** Item photo renditions, storage keys (never URLs) — spec note 6. */
export interface FnbPhotoKeys {
  thumb: string;
  detail: string;
}

/** Spec note 6 — list thumb / detail renditions for item photos. */
export const FNB_PHOTO_PRESET: RenditionPreset = {
  thumb: { width: 480, height: 360, fit: 'cover', quality: 80 },
  detail: { width: 1200, height: 1200, fit: 'inside', quality: 82, withoutEnlargement: true },
};

export const FNB_MAX_WINDOWS = 4;
export const FNB_MAX_VARIANT_OPTIONS = 6;
export const FNB_MAX_LINE_QUANTITY = 20;
export const FNB_MAX_ORDER_LINES = 30;
export const FNB_MAX_SPOT_LENGTH = 10;
