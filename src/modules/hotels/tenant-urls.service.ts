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
    const guestBase = this.config
      .get('GUEST_APP_BASE_URL', 'https://guest.gxp.example')
      .replace(/\/+$/, '');
    return {
      tenantDashboard: `https://${slug}.${domain}`,
      guestApp: `${guestBase}/${slug}`,
    };
  }
}
