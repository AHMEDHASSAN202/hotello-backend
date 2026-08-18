import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TenantUrls {
  tenantDashboard: string;
  guestApp: string;
}

/**
 * Story 5.7 — tenant URLs derive from the slug + env and are never stored.
 * Subdomain per tenant is the primary scheme (resolved decision #1).
 */
@Injectable()
export class TenantUrlsService {
  constructor(private readonly config: ConfigService) {}

  buildUrls(slug: string): TenantUrls {
    const domain = this.config.get('TENANT_BASE_DOMAIN', 'gxp.example');
    return {
      tenantDashboard: `https://${slug}.${domain}`,
      guestApp: `${this.guestBase()}/${slug}`,
    };
  }

  /**
   * Story 11.5 AC4/AC5 — the single guest-URL builder every QR (general,
   * room, and future location/F&B) reuses. Deterministic (same inputs →
   * same string, safe to regenerate on demand) and never persisted.
   * `params` is encoded via `URLSearchParams` so arbitrary keys (AC5's
   * `location=pool-bar` hook) need no new machinery.
   */
  buildGuestUrl(slug: string, params?: Record<string, string>): string {
    const base = `${this.guestBase()}/${slug}`;
    if (!params || Object.keys(params).length === 0) {
      return base;
    }
    return `${base}?${new URLSearchParams(params).toString()}`;
  }

  private guestBase(): string {
    return this.config
      .get('GUEST_APP_BASE_URL', 'https://guest.gxp.example')
      .replace(/\/+$/, '');
  }
}
