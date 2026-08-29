import { TranslationMap } from '../requests/requests.constants';
import { FnbWindow } from '../fnb/fnb.constants';
import { RenditionPreset } from '../renditions/rendition.interface';

/**
 * Epic 17 — Hotel Info / Directory. Fixed platform-defined section types,
 * hotel-filled (17.1 AC1); the array order IS the guest render order
 * (Essentials pinned first, 17.2 AC2). One entity typed by section — the
 * spec explicitly forbids normalizing five section types into five tables.
 */
export const HOTEL_INFO_SECTIONS = [
  'essentials',
  'facilities',
  'services',
  'house_rules',
  'about',
] as const;
export type HotelInfoSection = (typeof HOTEL_INFO_SECTIONS)[number];

/** Sections holding repeatable entries (CRUD + reorder + active toggle). */
export const REPEATABLE_SECTIONS: HotelInfoSection[] = [
  'facilities',
  'services',
  'house_rules',
];
/** One row per hotel, managed as PUT upserts; all-empty upsert deletes. */
export const SINGLETON_SECTIONS: HotelInfoSection[] = ['essentials', 'about'];

/** Same time-window component as menus (17.1 AC1) — same cap. */
export const HOTEL_INFO_MAX_WINDOWS = 4;

/** Per-section photo caps: facility card photo (1), About gallery (8). */
export const HOTEL_INFO_MAX_PHOTOS: Record<HotelInfoSection, number> = {
  essentials: 0,
  facilities: 1,
  services: 0,
  house_rules: 0,
  about: 8,
};

export const HOTEL_INFO_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** A stored photo: stable id so deletes address a photo, keys never URLs. */
export interface HotelInfoPhoto {
  id: string;
  thumb: string;
  detail: string;
}

/** Same two-rendition pipeline as F&B (spec note 5) — facility card / gallery photos. */
export const HOTEL_INFO_PHOTO_PRESET: RenditionPreset = {
  thumb: { width: 480, height: 360, fit: 'cover', quality: 80 },
  detail: { width: 1200, height: 1200, fit: 'inside', quality: 82, withoutEnlargement: true },
};

/**
 * Essentials singleton fields (17.1 AC1). Plain strings — phone formats are
 * not enforced (international variance); the guest app renders tel: links.
 * Checkout time is NEVER stored here — projected from hotel.checkoutTime.
 */
export interface EssentialsStructured {
  wifiName?: string;
  wifiPassword?: string;
  receptionPhone?: string;
  whatsapp?: string;
  emergencyPhone?: string;
}

export interface FacilityStructured {
  /** Hotel-local wall-clock windows; [] / absent = always open. */
  windows?: FnbWindow[];
  /** "Building B, floor 2" — translated, optional (EN fallback). */
  locationNote?: TranslationMap;
}

export interface ServiceStructured {
  /** How to get it — translated free text. */
  howTo?: TranslationMap;
  /** Optional price note — translated free text. */
  priceNote?: TranslationMap;
}

export type HotelInfoStructured = EssentialsStructured &
  FacilityStructured &
  ServiceStructured;
