import { TenantUser } from '../tenant-users/tenant-user.entity';

/**
 * Story 22.6 AC2 — revenue visibility is a THIRD, separate permission key
 * (`reports.revenue`), not implied by `reports.read`. Field-level gating
 * (the guard gates routes, not payload shapes) — same pattern as
 * `canReadStays` in `tenant-rooms.controller.ts`.
 */
export function canReadRevenue(user: TenantUser): boolean {
  const permissions = user.role?.permissions ?? [];
  return permissions.includes('*') || permissions.includes('reports.revenue');
}
