import { TranslationMap } from '../requests/requests.constants';
import { HotelInfoEntry } from './hotel-info-entry.entity';
import { HotelInfoSection, HotelInfoStructured } from './hotel-info.constants';

/** Management view — full translation maps (the editor edits all 7). */
export interface InfoEntryManageView {
  id: string;
  section: HotelInfoSection;
  names: TranslationMap;
  descriptions: TranslationMap | null;
  structured: HotelInfoStructured;
  photos: { id: string; thumbUrl: string; detailUrl: string }[];
  sortOrder: number;
  isActive: boolean;
}

export interface HotelInfoManageView {
  /** Projection of the Epic 13 setting — read-only here (spec note 4). */
  checkoutTime: string;
  essentials: InfoEntryManageView | null;
  facilities: InfoEntryManageView[];
  services: InfoEntryManageView[];
  houseRules: InfoEntryManageView[];
  about: InfoEntryManageView | null;
}

/** Keys → API-relative paths; the client prefixes the API base (repo law). */
export function toManageView(entry: HotelInfoEntry): InfoEntryManageView {
  return {
    id: entry.id,
    section: entry.section,
    names: entry.names,
    descriptions: entry.descriptions,
    structured: entry.structured,
    photos: entry.photos.map((p) => ({
      id: p.id,
      thumbUrl: `files/${p.thumb}`,
      detailUrl: `files/${p.detail}`,
    })),
    sortOrder: entry.sortOrder,
    isActive: entry.isActive,
  };
}
