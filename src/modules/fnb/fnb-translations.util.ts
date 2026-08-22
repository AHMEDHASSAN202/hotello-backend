import { BadRequestException } from '@nestjs/common';
import { TranslationMap } from '../requests/requests.constants';

/**
 * Flat DTO fields (`nameAr`…`nameDe`) ↔ JSONB translation maps — the Epic 15
 * custom-item convention, shared by every F&B DTO (16.2 AC1/AC2).
 */
export const NAME_KEYS = [
  ['nameAr', 'ar'],
  ['nameEn', 'en'],
  ['nameRu', 'ru'],
  ['nameFr', 'fr'],
  ['nameIt', 'it'],
  ['nameEs', 'es'],
  ['nameDe', 'de'],
] as const;

export const DESCRIPTION_KEYS = [
  ['descriptionAr', 'ar'],
  ['descriptionEn', 'en'],
  ['descriptionRu', 'ru'],
  ['descriptionFr', 'fr'],
  ['descriptionIt', 'it'],
  ['descriptionEs', 'es'],
  ['descriptionDe', 'de'],
] as const;

type NameFields = Partial<Record<(typeof NAME_KEYS)[number][0], string>>;
type DescriptionFields = Partial<
  Record<(typeof DESCRIPTION_KEYS)[number][0], string>
>;

/** Merge DTO name fields over an existing map; ar + en must survive. */
export function mergeNames(
  dto: NameFields,
  existing: TranslationMap = {},
): TranslationMap {
  const names: TranslationMap = { ...existing };
  for (const [dtoKey, lang] of NAME_KEYS) {
    const value = dto[dtoKey];
    if (value !== undefined) names[lang] = value.trim();
  }
  if (!names.ar || !names.en) {
    throw new BadRequestException({
      code: 'FNB_NAMES_REQUIRED',
      message: 'Arabic and English names are required',
    });
  }
  return names;
}

/** Merge DTO description fields; empty result collapses to null. */
export function mergeDescriptions(
  dto: DescriptionFields,
  existing: TranslationMap | null = null,
): TranslationMap | null {
  const descriptions: TranslationMap = { ...(existing ?? {}) };
  for (const [dtoKey, lang] of DESCRIPTION_KEYS) {
    const value = dto[dtoKey];
    if (value !== undefined) {
      if (value.trim()) descriptions[lang] = value.trim();
      else delete descriptions[lang];
    }
  }
  return Object.keys(descriptions).length ? descriptions : null;
}

export function touchesNames(dto: NameFields): boolean {
  return NAME_KEYS.some(([dtoKey]) => dto[dtoKey] !== undefined);
}

export function touchesDescriptions(dto: DescriptionFields): boolean {
  return DESCRIPTION_KEYS.some(([dtoKey]) => dto[dtoKey] !== undefined);
}

/** Kebab slug of an EN label — location keys and variant option keys. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
