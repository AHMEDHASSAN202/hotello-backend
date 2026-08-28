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
  {
    group: 'stays',
    labelEn: 'Stays',
    labelAr: 'الإقامات',
    permissions: [
      {
        key: 'stays.read',
        labelEn: 'View stays',
        labelAr: 'عرض الإقامات',
        descriptionEn: 'See current and past stays and room occupancy.',
        descriptionAr: 'عرض الإقامات الحالية والسابقة وإشغال الغرف.',
      },
      {
        key: 'stays.checkin',
        labelEn: 'Check in guests',
        labelAr: 'تسجيل دخول النزلاء',
        descriptionEn: 'Check a guest into a room and issue their stay code.',
        descriptionAr: 'تسجيل دخول النزيل إلى غرفة وإصدار رمز الإقامة الخاص به.',
      },
      {
        key: 'stays.update',
        labelEn: 'Manage stays',
        labelAr: 'إدارة الإقامات',
        descriptionEn:
          'Extend stays, change rooms, edit guest info, regenerate codes, and edit stay settings.',
        descriptionAr:
          'تمديد الإقامات وتغيير الغرف وتعديل بيانات النزلاء وإعادة إصدار الرموز وتعديل إعدادات الإقامة.',
      },
      {
        key: 'stays.checkout',
        labelEn: 'Check out guests',
        labelAr: 'تسجيل خروج النزلاء',
        descriptionEn: 'End a stay and sign the guest out of the app.',
        descriptionAr: 'إنهاء الإقامة وتسجيل خروج النزيل من التطبيق.',
      },
    ],
  },
  {
    // Epic 15 — first module-gated group: dormant on every role while the
    // `requests` module is outside the hotel's plan (Story 10.5 AC3).
    group: 'requests',
    labelEn: 'Guest Requests',
    labelAr: 'طلبات النزلاء',
    module: 'requests',
    permissions: [
      {
        key: 'requests.read',
        labelEn: 'View requests',
        labelAr: 'عرض الطلبات',
        descriptionEn: 'See the requests board, history and details.',
        descriptionAr: 'عرض لوحة الطلبات وسجلها وتفاصيلها.',
      },
      {
        key: 'requests.update',
        labelEn: 'Work requests',
        labelAr: 'معالجة الطلبات',
        descriptionEn: 'Start, complete and cancel guest requests.',
        descriptionAr: 'بدء طلبات النزلاء وإكمالها وإلغاؤها.',
      },
      {
        key: 'requests.assign',
        labelEn: 'Assign requests',
        labelAr: 'إسناد الطلبات',
        descriptionEn: 'Assign or reassign requests to staff members.',
        descriptionAr: 'إسناد الطلبات إلى الموظفين أو إعادة إسنادها.',
      },
      {
        key: 'request_catalog.manage',
        labelEn: 'Manage request catalog',
        labelAr: 'إدارة قائمة الطلبات',
        descriptionEn:
          'Enable, disable and reorder catalog items, adjust SLA targets, and add custom items.',
        descriptionAr:
          'تفعيل عناصر القائمة وتعطيلها وإعادة ترتيبها وتعديل أهداف زمن الاستجابة وإضافة عناصر مخصصة.',
      },
    ],
  },
  {
    // Epic 16 — F&B ordering; dormant while the `fnb` module is outside the
    // hotel's plan (Story 10.5 AC3).
    group: 'fnb',
    labelEn: 'Food & Beverage',
    labelAr: 'الأغذية والمشروبات',
    module: 'fnb',
    permissions: [
      {
        key: 'fnb_menus.manage',
        labelEn: 'Manage menus',
        labelAr: 'إدارة قوائم الطعام',
        descriptionEn:
          'Create and edit menus, sections and items, photos, prices and availability windows.',
        descriptionAr:
          'إنشاء وتعديل قوائم الطعام والأقسام والأصناف والصور والأسعار وأوقات الإتاحة.',
      },
      {
        key: 'fnb_locations.manage',
        labelEn: 'Manage delivery locations',
        labelAr: 'إدارة أماكن التوصيل',
        descriptionEn:
          'Define delivery locations (pool, beach…) and print their QR stickers.',
        descriptionAr:
          'تحديد أماكن التوصيل (المسبح، الشاطئ…) وطباعة ملصقات QR الخاصة بها.',
      },
      {
        key: 'fnb_orders.read',
        labelEn: 'View orders',
        labelAr: 'عرض الطلبات',
        descriptionEn: 'See the kitchen board, order history and details.',
        descriptionAr: 'عرض لوحة المطبخ وسجل الطلبات وتفاصيلها.',
      },
      {
        key: 'fnb_orders.update',
        labelEn: 'Work orders',
        labelAr: 'معالجة الطلبات',
        descriptionEn:
          'Start, deliver, cancel and assign food & beverage orders.',
        descriptionAr:
          'بدء طلبات الأغذية والمشروبات وتوصيلها وإلغاؤها وإسنادها.',
      },
      {
        key: 'fnb_settings.manage',
        labelEn: 'Manage F&B settings',
        labelAr: 'إدارة إعدادات الأغذية والمشروبات',
        descriptionEn: 'Configure guest payment methods for orders.',
        descriptionAr: 'ضبط طرق دفع النزلاء للطلبات.',
      },
    ],
  },
  {
    // Epic 17 — the digital compendium; dormant while the `hotel_info`
    // module is outside the hotel's plan (Story 10.5 AC3).
    group: 'hotel_info',
    labelEn: 'Hotel Info',
    labelAr: 'معلومات الفندق',
    module: 'hotel_info',
    permissions: [
      {
        key: 'hotel_info.manage',
        labelEn: 'Manage hotel info',
        labelAr: 'إدارة معلومات الفندق',
        descriptionEn:
          'Edit the guest-facing hotel directory: WiFi, facilities, services, house rules and about.',
        descriptionAr:
          'تعديل دليل الفندق الظاهر للنزلاء: الواي فاي والمرافق والخدمات وقواعد الإقامة وعن الفندق.',
      },
    ],
  },
  {
    // Epic 19 — the hotel speaks to its guests; dormant while the
    // `announcements` module is outside the hotel's plan (Story 10.5 AC3).
    group: 'announcements',
    labelEn: 'Announcements',
    labelAr: 'الإعلانات',
    module: 'announcements',
    permissions: [
      {
        key: 'announcements.manage',
        labelEn: 'Manage announcements',
        labelAr: 'إدارة الإعلانات',
        descriptionEn:
          'Compose, schedule and retract guest announcements, and view read stats.',
        descriptionAr:
          'إنشاء إعلانات النزلاء وجدولتها وسحبها والاطلاع على إحصاءات القراءة.',
      },
    ],
  },
  {
    // Epic 20 — housekeeping operations; dormant while the `housekeeping`
    // module is outside the hotel's plan (Story 10.5 AC3).
    group: 'housekeeping',
    labelEn: 'Housekeeping',
    labelAr: 'التدبير الفندقي',
    module: 'housekeeping',
    permissions: [
      {
        key: 'housekeeping.read',
        labelEn: 'View housekeeping board',
        labelAr: 'عرض لوحة التدبير الفندقي',
        descriptionEn:
          'See the cleaning board, room cleanliness states and daily progress.',
        descriptionAr:
          'عرض لوحة التنظيف وحالات نظافة الغرف وتقدم العمل اليومي.',
      },
      {
        key: 'housekeeping.update',
        labelEn: 'Work the cleaning queue',
        labelAr: 'معالجة قائمة التنظيف',
        descriptionEn:
          'Start, complete and interrupt room cleans, flag or unflag rooms, and edit housekeeping settings.',
        descriptionAr:
          'بدء تنظيف الغرف وإكماله وإيقافه، ووضع علامات التنظيف أو إزالتها، وتعديل إعدادات التدبير الفندقي.',
      },
      {
        key: 'housekeeping.assign',
        labelEn: 'Assign rooms',
        labelAr: 'إسناد الغرف',
        descriptionEn:
          'Assign or reassign rooms and whole floors to attendants.',
        descriptionAr: 'إسناد الغرف والطوابق الكاملة إلى العاملين أو إعادة إسنادها.',
      },
    ],
  },
  {
    // Epic 18 — Guest App Branding; dormant while the `guest_app_branding`
    // module is outside the hotel's plan (Story 10.5 AC3) — it's the upsell.
    group: 'branding',
    labelEn: 'Guest App Branding',
    labelAr: 'تخصيص هوية تطبيق الضيوف',
    module: 'guest_app_branding',
    permissions: [
      {
        key: 'branding.manage',
        labelEn: 'Manage guest app branding',
        labelAr: 'إدارة هوية تطبيق الضيوف',
        descriptionEn:
          'Customize the guest app accent color, cover image, and welcome message.',
        descriptionAr:
          'تخصيص لون التمييز وصورة الغلاف ورسالة الترحيب في تطبيق الضيوف.',
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
