import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TenantAccessService } from '../tenant-access/tenant-access.service';

/**
 * Public hotel profile for the Guest App shell (14.4 AC1) — branding basics
 * only, nothing internal. Suspended and expired hotels RESOLVE with
 * `status: 'unavailable'` (rather than erroring like the session endpoint) so
 * the app can render its branded unavailable screen; the two causes are
 * deliberately indistinguishable to guests (14.6 AC1).
 */
export interface GuestHotelProfile {
  slug: string;
  nameEn: string;
  nameAr: string;
  /** Storage key relative to the API base (`{API}/files/{key}`), or null. */
  logoUrl: string | null;
  status: 'active' | 'unavailable';
  /** Only non-null when the plan includes `guest_app_branding` (14.4 AC5). */
  brandAccentColor: string | null;
  /** Hotel-local checkout hour 'HH:MM' — pairs with the stay's checkOutDate. */
  checkoutTime: string;
  /** IANA timezone — the app derives "checkout is today" in hotel time. */
  timezone: string;
  defaultLanguage: string;
  /** Plan modules, for services-grid tile gating (14.4 AC3). */
  enabledModules: string[];
}

const DEFAULT_CACHE_TTL_MS = 60_000;

@Injectable()
export class GuestProfileService {
  /** QR scans hammer this route — cache per slug (spec: 60s+). */
  private readonly cache = new Map<
    string,
    { value: GuestHotelProfile; expiresAt: number }
  >();
  private readonly ttlMs: number;

  constructor(
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly tenantAccess: TenantAccessService,
    config: ConfigService,
  ) {
    this.ttlMs = Number(
      config.get('GUEST_PROFILE_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS),
    );
  }

  async getProfile(rawSlug: string): Promise<GuestHotelProfile> {
    const slug = rawSlug.toLowerCase();
    const cached = this.cache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const hotel = await this.hotelsRepo.findOne({ where: { slug } });
    if (!hotel || hotel.status === 'inactive') {
      // Same shape as the session endpoint — unknown and offboarded look alike.
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }

    const access = await this.tenantAccess.getAccessState(hotel.id);
    const unavailable = hotel.status === 'suspended' || access.readOnly;
    const branded = access.enabledModules.includes('guest_app_branding');

    const value: GuestHotelProfile = {
      slug: hotel.slug,
      nameEn: hotel.nameEn,
      nameAr: hotel.nameAr,
      logoUrl: hotel.logoPath ? `files/${hotel.logoPath}` : null,
      status: unavailable ? 'unavailable' : 'active',
      brandAccentColor: branded ? hotel.brandAccentColor : null,
      checkoutTime: hotel.checkoutTime,
      timezone: hotel.timezone,
      defaultLanguage: hotel.defaultLanguage,
      enabledModules: access.enabledModules,
    };
    this.cache.set(slug, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }
}
