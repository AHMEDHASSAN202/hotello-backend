import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  localizeField,
  TranslationMap,
} from '../requests/requests.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { FnbWindow } from '../fnb/fnb.constants';
import { HotelInfoEntry } from './hotel-info-entry.entity';
import { HotelInfoSection } from './hotel-info.constants';

export interface GuestInfoFacility {
  id: string;
  name: string;
  description: string | null;
  windows: FnbWindow[];
  locationNote: string | null;
  photoThumbUrl: string | null;
  photoDetailUrl: string | null;
}

export interface GuestInfoService {
  id: string;
  name: string;
  description: string | null;
  howTo: string | null;
  priceNote: string | null;
}

export interface GuestInfoRule {
  id: string;
  name: string;
  description: string | null;
}

export interface GuestHotelInfo {
  essentials: {
    wifiName: string | null;
    wifiPassword: string | null;
    receptionPhone: string | null;
    whatsapp: string | null;
    emergencyPhone: string | null;
    /** Projection of the Epic 13 setting (spec note 4). */
    checkoutTime: string;
  } | null;
  facilities: GuestInfoFacility[];
  services: GuestInfoService[];
  houseRules: GuestInfoRule[];
  about: {
    text: string | null;
    gallery: { thumbUrl: string; detailUrl: string }[];
  } | null;
}

const DEFAULT_CACHE_TTL_MS = 60_000;

const bySort = (a: { sortOrder: number }, b: { sortOrder: number }): number =>
  a.sortOrder - b.sortOrder;

/**
 * Epic 17, Story 17.2 — the guest directory. Language resolved server-side
 * per entry via localizeField (AC3); "open now" is left to the client (it
 * has the raw windows + the hotel timezone) so responses cache per
 * hotel+language for 60s like the profile endpoint (spec note 2).
 */
@Injectable()
export class GuestHotelInfoService {
  private readonly cache = new Map<
    string,
    { value: GuestHotelInfo; expiresAt: number }
  >();
  private readonly ttlMs: number;

  constructor(
    @InjectRepository(HotelInfoEntry)
    private readonly repo: Repository<HotelInfoEntry>,
    private readonly access: TenantAccessService,
    config: ConfigService,
  ) {
    this.ttlMs = Number(
      config.get('HOTEL_INFO_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS),
    );
  }

  async getHotelInfo(stay: Stay): Promise<GuestHotelInfo> {
    await this.assertAvailable(stay.hotelId);
    const language = stay.language;
    const cacheKey = `${stay.hotelId}:${language}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const entries = await this.repo.find({
      where: { hotelId: stay.hotelId, isActive: true },
    });
    const of = (section: HotelInfoSection): HotelInfoEntry[] =>
      entries.filter((e) => e.section === section).sort(bySort);

    const text = (
      map: TranslationMap | null | undefined,
    ): string | null => {
      const value = localizeField(map, language);
      return value || null;
    };

    const essentialsRow = of('essentials')[0];
    const aboutRow = of('about')[0];

    const value: GuestHotelInfo = {
      essentials: essentialsRow
        ? {
            wifiName: essentialsRow.structured.wifiName ?? null,
            wifiPassword: essentialsRow.structured.wifiPassword ?? null,
            receptionPhone: essentialsRow.structured.receptionPhone ?? null,
            whatsapp: essentialsRow.structured.whatsapp ?? null,
            emergencyPhone: essentialsRow.structured.emergencyPhone ?? null,
            checkoutTime: stay.hotel.checkoutTime,
          }
        : null,
      facilities: of('facilities').map((e) => ({
        id: e.id,
        name: localizeField(e.names, language),
        description: text(e.descriptions),
        windows: e.structured.windows ?? [],
        locationNote: text(e.structured.locationNote),
        photoThumbUrl: e.photos[0] ? `files/${e.photos[0].thumb}` : null,
        photoDetailUrl: e.photos[0] ? `files/${e.photos[0].detail}` : null,
      })),
      services: of('services').map((e) => ({
        id: e.id,
        name: localizeField(e.names, language),
        description: text(e.descriptions),
        howTo: text(e.structured.howTo),
        priceNote: text(e.structured.priceNote),
      })),
      houseRules: of('house_rules').map((e) => ({
        id: e.id,
        name: localizeField(e.names, language),
        description: text(e.descriptions),
      })),
      about: aboutRow
        ? {
            text: text(aboutRow.descriptions),
            gallery: aboutRow.photos.map((p) => ({
              thumbUrl: `files/${p.thumb}`,
              detailUrl: `files/${p.detail}`,
            })),
          }
        : null,
    };
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  /** Same gating story as F&B (guest guard no-ops on @GuestScope). */
  private async assertAvailable(hotelId: string): Promise<void> {
    const state = await this.access.getAccessState(hotelId);
    if (state.hotelStatus === 'suspended' || state.readOnly) {
      throw new ForbiddenException({
        code: 'HOTEL_UNAVAILABLE',
        message: 'This hotel is currently unavailable',
      });
    }
    if (!state.enabledModules.includes('hotel_info')) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: 'This module is not included in your plan',
        module: 'hotel_info',
      });
    }
  }
}
