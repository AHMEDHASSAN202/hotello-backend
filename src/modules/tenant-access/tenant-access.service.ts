import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { HotelStatus } from '../hotels/hotels.constants';
import {
  Subscription,
  SubscriptionStatus,
} from '../subscriptions/subscription.entity';

export interface TenantPublicContext {
  slug: string;
  nameEn: string;
  nameAr: string;
  /** Storage key relative to the files endpoint (`{API}/files/{logoUrl}`), or null. */
  logoUrl: string | null;
  status: 'active' | 'suspended';
  defaultLanguage: string;
}

export interface TenantAccessState {
  hotelStatus: HotelStatus;
  subscriptionStatus: SubscriptionStatus | null;
  trialEndsAt: Date | null;
  enabledModules: string[];
  planNameEn: string | null;
  planNameAr: string | null;
  /** Days left in the trial, or null when not on trial. */
  trialDaysRemaining: number | null;
  /** Expired/canceled subscriptions make the dashboard read-only (8.6 AC2). */
  readOnly: boolean;
}

/** Subscription states that put the dashboard into read-only mode. */
const READ_ONLY_STATUSES: SubscriptionStatus[] = ['expired', 'canceled'];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The single answer to "what can this hotel do right now?" (impl note 4):
 * active/suspended, subscription state, and which modules are enabled. Used by
 * TenantAccessGuard (enforcement) and GET /tenant/me (UI). Evaluated per request
 * with a short in-memory cache so live transitions (trial→expired, suspension,
 * plan change) land within seconds without a redeploy (8.6 AC4).
 */
@Injectable()
export class TenantAccessService {
  private readonly cache = new Map<
    string,
    { state: TenantAccessState; expiresAt: number }
  >();
  private readonly ttlMs: number;

  constructor(
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(Subscription)
    private readonly subscriptionsRepo: Repository<Subscription>,
    config: ConfigService,
  ) {
    this.ttlMs = parseInt(
      config.get('TENANT_ACCESS_CACHE_TTL_MS', '10000'),
      10,
    );
  }

  async getAccessState(hotelId: string): Promise<TenantAccessState> {
    const cached = this.cache.get(hotelId);
    if (cached && cached.expiresAt > Date.now()) return cached.state;

    const state = await this.loadState(hotelId);
    this.cache.set(hotelId, { state, expiresAt: Date.now() + this.ttlMs });
    return state;
  }

  /** Drops the cached state for a hotel (e.g. after an admin changes its plan). */
  invalidate(hotelId: string): void {
    this.cache.delete(hotelId);
  }

  /**
   * Story 8.1 AC1/AC3 — public branding for the app shell + lock/login pages.
   * Unknown or `inactive` slugs 404 (branded "hotel not found"); a `suspended`
   * hotel resolves so the app can render its locked page.
   */
  async getPublicContext(slug: string): Promise<TenantPublicContext> {
    const hotel = await this.hotelsRepo.findOne({
      where: { slug: slug.toLowerCase() },
    });
    if (!hotel || hotel.status === 'inactive') {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }
    return {
      slug: hotel.slug,
      nameEn: hotel.nameEn,
      nameAr: hotel.nameAr,
      logoUrl: hotel.logoPath ? `files/${hotel.logoPath}` : null,
      status: hotel.status === 'suspended' ? 'suspended' : 'active',
      defaultLanguage: hotel.defaultLanguage,
    };
  }

  private async loadState(hotelId: string): Promise<TenantAccessState> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    // The current subscription is the open row (endDate IS NULL).
    const subscription = await this.subscriptionsRepo.findOne({
      where: { hotelId, endDate: IsNull() },
      relations: ['plan'],
    });

    const status = subscription?.status ?? null;
    const trialEndsAt = subscription?.trialEndsAt ?? null;
    return {
      hotelStatus: hotel?.status ?? 'inactive',
      subscriptionStatus: status,
      trialEndsAt,
      enabledModules: subscription?.plan?.enabledModules ?? [],
      planNameEn: subscription?.plan?.nameEn ?? null,
      planNameAr: subscription?.plan?.nameAr ?? null,
      trialDaysRemaining:
        status === 'trial' && trialEndsAt
          ? Math.max(
              0,
              Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY_MS),
            )
          : null,
      readOnly: status ? READ_ONLY_STATUSES.includes(status) : false,
    };
  }
}
