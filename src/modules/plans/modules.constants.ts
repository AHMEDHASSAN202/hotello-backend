/**
 * The single source of truth for platform module keys — mirrors the
 * permission catalog pattern. Exposed via GET /plans/modules/catalog; the
 * frontend module checklist never hardcodes keys. Adding a platform module =
 * adding it here; plan forms pick it up automatically.
 */
export interface ModuleCatalogEntry {
  key: string;
  labelEn: string;
  labelAr: string;
}

export const MODULE_CATALOG: ModuleCatalogEntry[] = [
  { key: 'transportation', labelEn: 'Transportation', labelAr: 'النقل' },
  { key: 'housekeeping', labelEn: 'Housekeeping', labelAr: 'التدبير الفندقي' },
  { key: 'fnb', labelEn: 'Food & Beverage', labelAr: 'الأغذية والمشروبات' },
  {
    key: 'guest_app_branding',
    labelEn: 'Guest App Branding',
    labelAr: 'تخصيص هوية تطبيق الضيوف',
  },
  { key: 'analytics', labelEn: 'Analytics', labelAr: 'التحليلات' },
  { key: 'requests', labelEn: 'Guest Requests', labelAr: 'طلبات النزلاء' },
  { key: 'hotel_info', labelEn: 'Hotel Info', labelAr: 'معلومات الفندق' },
  { key: 'announcements', labelEn: 'Announcements', labelAr: 'الإعلانات' },
  { key: 'events', labelEn: 'Events & Workshops', labelAr: 'الفعاليات وورش العمل' },
];

export const ALL_MODULE_KEYS: string[] = MODULE_CATALOG.map((m) => m.key);
