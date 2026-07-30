import { WILDCARD } from '../roles/permissions.constants';

/**
 * Tenant-scoped permission catalog — separate from the platform catalog
 * (Epic 08, note 7). The Hotel Owner holds the wildcard ['*'] (seeded in
 * Epic 05); granular staff roles are managed in Epic 10, which exposes this
 * catalog via an endpoint the way the platform catalog is.
 *
 * Adding a tenant module = adding its keys here; guard routes with
 * @RequirePermissions('staff.read'). The '*' wildcard passes every check.
 */
export const TENANT_PERMISSION_CATALOG: Record<string, string[]> = {
  staff: ['staff.read', 'staff.invite', 'staff.update', 'staff.disable'],
  roles: [
    'roles.read',
    'roles.create',
    'roles.update',
    'roles.delete',
  ],
};

export const ALL_TENANT_PERMISSION_KEYS: string[] =
  Object.values(TENANT_PERMISSION_CATALOG).flat();

export { WILDCARD };
