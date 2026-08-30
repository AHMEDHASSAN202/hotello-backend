import { WILDCARD } from '../tenant-users/tenant-permissions.constants';

/**
 * Story 9.1 AC1/AC4 — the default roles seeded into every hotel, bilingual.
 * The permission catalog is staff/roles-only today; each future module epic
 * extends the operational roles (Manager/Front Desk/Housekeeping) with its own
 * keys. The Owner role always holds the wildcard and is a system role.
 */
export interface DefaultTenantRole {
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  permissions: string[];
  isSystem: boolean;
}

export const DEFAULT_TENANT_ROLES: DefaultTenantRole[] = [
  {
    nameEn: 'Owner',
    nameAr: 'المالك',
    descriptionEn: 'Full access to everything in the hotel dashboard.',
    descriptionAr: 'صلاحية كاملة على كل شيء في لوحة تحكم الفندق.',
    permissions: [WILDCARD],
    isSystem: true,
  },
  {
    nameEn: 'Manager',
    nameAr: 'المدير',
    descriptionEn: 'Manages staff and day-to-day operations.',
    descriptionAr: 'يدير الموظفين والعمليات اليومية.',
    permissions: [
      'staff.read',
      'staff.invite',
      'staff.update',
      'staff.disable',
      'roles.read',
      'rooms.read',
      'rooms.create',
      'rooms.update',
      'stays.read',
      'stays.checkin',
      'stays.update',
      'stays.checkout',
      'requests.read',
      'requests.update',
      'requests.assign',
      'request_catalog.manage',
      'fnb_menus.manage',
      'fnb_locations.manage',
      'fnb_orders.read',
      'fnb_orders.update',
      'fnb_settings.manage',
      'hotel_info.manage',
      'branding.manage',
      // Epic 19 — the manager owns guest communication.
      'announcements.manage',
      // Epic 20 — the manager runs the cleaning operation end to end.
      'housekeeping.read',
      'housekeeping.update',
      'housekeeping.assign',
      // Epic 21 — the manager runs events end to end (create/publish/cancel);
      // `.manage` does NOT imply `.read` (PermissionsGuard is exact-match),
      // so the read key ships alongside manage here too (final-review C1 —
      // matches every other module in this file and the migration backfill
      // for existing hotels).
      'events.manage',
      'events.read',
    ],
    isSystem: false,
  },
  {
    nameEn: 'Front Desk',
    nameAr: 'موظف الاستقبال',
    descriptionEn: 'Handles front-desk guest operations.',
    descriptionAr: 'يتولى عمليات الاستقبال والنزلاء.',
    permissions: [
      'rooms.read',
      'stays.read',
      'stays.checkin',
      'stays.update',
      'stays.checkout',
      'requests.read',
      'requests.update',
      'requests.assign',
      // Epic 16 — room-charge visibility at checkout (16.8); settling rides
      // on stays.checkout, not an fnb key.
      'fnb_orders.read',
      // Epic 17 — front desk knows the practical answers guests ask.
      'hotel_info.manage',
      // Epic 19 — front desk posts the operational notices.
      'announcements.manage',
      // Epic 20 — read-only board access answers "is my room ready?".
      'housekeeping.read',
      // Epic 21 — front desk can see attendee counts but not manage events.
      'events.read',
    ],
    isSystem: false,
  },
  {
    nameEn: 'Housekeeping',
    nameAr: 'التدبير الفندقي',
    descriptionEn: 'Handles housekeeping operations.',
    descriptionAr: 'يتولى عمليات التدبير الفندقي.',
    permissions: [
      'rooms.read',
      'rooms.update',
      'requests.read',
      'requests.update',
      // Epic 20 — attendants work the queue; assignment stays with managers.
      'housekeeping.read',
      'housekeeping.update',
    ],
    isSystem: false,
  },
  {
    // Epic 16 — the kitchen persona: works the board and owns the menus.
    nameEn: 'F&B / Kitchen',
    nameAr: 'الأغذية والمشروبات',
    descriptionEn: 'Works the kitchen board and manages the menus.',
    descriptionAr: 'يعمل على لوحة المطبخ ويدير قوائم الطعام.',
    permissions: ['fnb_orders.read', 'fnb_orders.update', 'fnb_menus.manage'],
    isSystem: false,
  },
];
