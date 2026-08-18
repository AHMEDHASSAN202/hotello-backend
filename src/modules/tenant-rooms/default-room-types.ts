/**
 * Story 11.1 AC2 — the default room types seeded into every hotel, bilingual.
 * Mirrors `default-tenant-roles.ts`: find-or-create by (hotelId, nameEn), safe
 * to run on onboarding, from the seed script, and as a backfill for existing
 * hotels. Hotels can add more types or deactivate these; they are never
 * hard-deleted.
 */
export interface DefaultRoomType {
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

export const DEFAULT_ROOM_TYPES: DefaultRoomType[] = [
  {
    nameEn: 'Standard',
    nameAr: 'قياسية',
    descriptionEn: 'Standard room.',
    descriptionAr: 'غرفة قياسية.',
  },
  {
    nameEn: 'Deluxe',
    nameAr: 'ديلوكس',
    descriptionEn: 'Deluxe room with upgraded amenities.',
    descriptionAr: 'غرفة ديلوكس بتجهيزات محسّنة.',
  },
  {
    nameEn: 'Suite',
    nameAr: 'جناح',
    descriptionEn: 'Suite with separate living area.',
    descriptionAr: 'جناح بمنطقة معيشة منفصلة.',
  },
];
