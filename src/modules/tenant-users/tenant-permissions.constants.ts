import { Logger } from '@nestjs/common';
import { WILDCARD } from '../roles/permissions.constants';

/**
 * Tenant-scoped permission catalog — separate from the platform catalog
 * (Epic 08, note 7; never merged, never cross-imported into guards). The Hotel
 * Owner holds the wildcard ['*'] (seeded in Epic 05) and passes every check.
 *
 * Epic 10 (Story 10.5 AC1) makes this the single source of truth the roles
 * matrix UI renders from: each group and permission carries AR/EN labels +
 * descriptions, so adding a module's permissions needs no matrix-UI change.
 * A group may declare a `module`; when set, the group is gated by the hotel's
 * `enabled_modules` (Story 10.5 AC3). Core groups (staff, roles) omit it and
 * are always visible.
 *
 * Adding a tenant module = adding its group here; guard routes with
 * @RequirePermissions('<module>.<action>').
 */
export interface TenantPermissionDef {
  key: string;
  labelEn: string;
  labelAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

export interface TenantPermissionGroup {
  group: string;
  labelEn: string;
  labelAr: string;
  /** When set, this group is only shown/valid if the module is enabled. */
  module?: string;
  permissions: TenantPermissionDef[];
}

export const TENANT_PERMISSION_CATALOG: TenantPermissionGroup[] = [
  {
    group: 'staff',
    labelEn: 'Staff',
    labelAr: 'الموظفون',
    permissions: [
      {
        key: 'staff.read',
        labelEn: 'View staff',
        labelAr: 'عرض الموظفين',
        descriptionEn: 'See the staff list and their roles.',
        descriptionAr: 'عرض قائمة الموظفين وأدوارهم.',
      },
      {
        key: 'staff.invite',
        labelEn: 'Invite staff',
        labelAr: 'دعوة الموظفين',
        descriptionEn: 'Invite new staff members and create accounts.',
        descriptionAr: 'دعوة موظفين جدد وإنشاء حسابات.',
      },
      {
        key: 'staff.update',
        labelEn: 'Edit staff',
        labelAr: 'تعديل الموظفين',
        descriptionEn: 'Edit staff details and change their role.',
        descriptionAr: 'تعديل بيانات الموظفين وتغيير أدوارهم.',
      },
      {
        key: 'staff.disable',
        labelEn: 'Disable staff',
        labelAr: 'تعطيل الموظفين',
        descriptionEn: 'Disable or re-enable staff accounts.',
        descriptionAr: 'تعطيل حسابات الموظفين أو إعادة تفعيلها.',
      },
    ],
  },
  {
    group: 'roles',
    labelEn: 'Roles',
    labelAr: 'الأدوار',
    permissions: [
      {
        key: 'roles.read',
        labelEn: 'View roles',
        labelAr: 'عرض الأدوار',
        descriptionEn: 'See roles and their permissions.',
        descriptionAr: 'عرض الأدوار وصلاحياتها.',
      },
      {
        key: 'roles.create',
        labelEn: 'Create roles',
        labelAr: 'إنشاء الأدوار',
        descriptionEn: 'Create custom roles with a permission set.',
        descriptionAr: 'إنشاء أدوار مخصصة بمجموعة صلاحيات.',
      },
      {
        key: 'roles.update',
        labelEn: 'Edit roles',
        labelAr: 'تعديل الأدوار',
        descriptionEn: 'Edit a role’s details and permissions.',
        descriptionAr: 'تعديل تفاصيل الدور وصلاحياته.',
      },
      {
        key: 'roles.delete',
        labelEn: 'Delete roles',
        labelAr: 'حذف الأدوار',
        descriptionEn: 'Delete roles that are no longer needed.',
        descriptionAr: 'حذف الأدوار التي لم تعد مطلوبة.',
      },
    ],
  },
  {
    group: 'rooms',
    labelEn: 'Rooms',
    labelAr: 'الغرف',
    permissions: [
      {
        key: 'rooms.read',
        labelEn: 'View rooms',
        labelAr: 'عرض الغرف',
        descriptionEn: 'See the room list, types and their status.',
        descriptionAr: 'عرض قائمة الغرف وأنواعها وحالاتها.',
      },
      {
        key: 'rooms.create',
        labelEn: 'Add rooms',
        labelAr: 'إضافة غرف',
        descriptionEn: 'Add new rooms.',
        descriptionAr: 'إضافة غرف جديدة.',
      },
      {
        key: 'rooms.update',
        labelEn: 'Edit rooms & status',
        labelAr: 'تعديل الغرف والحالات',
        descriptionEn: 'Edit room details, change their status, and manage room types.',
        descriptionAr: 'تعديل بيانات الغرف وتغيير حالاتها وإدارة أنواع الغرف.',
      },
    ],
  },
];

export const ALL_TENANT_PERMISSION_KEYS: string[] =
  TENANT_PERMISSION_CATALOG.flatMap((group) =>
    group.permissions.map((permission) => permission.key),
  );

const KEY_TO_GROUP = new Map<string, TenantPermissionGroup>(
  TENANT_PERMISSION_CATALOG.flatMap((group) =>
    group.permissions.map(
      (permission) => [permission.key, group] as [string, TenantPermissionGroup],
    ),
  ),
);

const catalogLogger = new Logger('TenantPermissionCatalog');

/** Fail-closed helper (Story 10.5 AC2): unknown keys are never granted. */
export function isKnownTenantPermission(key: string): boolean {
  return KEY_TO_GROUP.has(key);
}

/**
 * Resolve the catalog group a key belongs to. A miss is logged and returns
 * undefined so callers can deny — a typo can never grant access.
 */
export function findTenantPermissionGroup(
  key: string,
): TenantPermissionGroup | undefined {
  const group = KEY_TO_GROUP.get(key);
  if (!group) {
    catalogLogger.warn(`Unknown tenant permission key referenced: ${key}`);
  }
  return group;
}

export { WILDCARD };
