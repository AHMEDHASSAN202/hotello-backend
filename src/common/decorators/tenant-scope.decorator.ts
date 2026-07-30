import { SetMetadata } from '@nestjs/common';

export const TENANT_SCOPE_KEY = 'isTenantScope';

/**
 * Marks a controller (or route) as belonging to the Tenant Dashboard. The
 * global JwtAuthGuard then authenticates it with the `tenant-jwt` strategy
 * instead of the platform-admin `jwt` strategy, and PermissionsGuard evaluates
 * the tenant permission catalog — so an admin token is never valid here and
 * vice versa (Story 8.3 AC3, 8.5 AC1).
 */
export const TenantScope = () => SetMetadata(TENANT_SCOPE_KEY, true);
