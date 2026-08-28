import { BadRequestException } from '@nestjs/common';
import { TranslationMap } from '../requests/requests.constants';

/**
 * Flat DTO fields (`titleAr`…`bodyDe`) ↔ JSONB translation maps — the Epic
 * 15/16 convention applied to announcements (19.1 AC1). Unlike the F&B merge,
 * a blanked OPTIONAL locale is removed from the map (never stored as '') so
 * localizeField's EN fallback keeps working; ar + en must always survive.
 */
export const TITLE_KEYS = [
  ['titleAr', 'ar'],
  ['titleEn', 'en'],
  ['titleRu', 'ru'],
  ['titleFr', 'fr'],
  ['titleIt', 'it'],
  ['titleEs', 'es'],
  ['titleDe', 'de'],
] as const;

export const BODY_KEYS = [
  ['bodyAr', 'ar'],
  ['bodyEn', 'en'],
  ['bodyRu', 'ru'],
  ['bodyFr', 'fr'],
  ['bodyIt', 'it'],
  ['bodyEs', 'es'],
  ['bodyDe', 'de'],
] as const;

export type TitleFields = Partial<
  Record<(typeof TITLE_KEYS)[number][0], string>
>;
export type BodyFields = Partial<Record<(typeof BODY_KEYS)[number][0], string>>;

function merge(
  dto: Record<string, string | undefined>,
  keys: typeof TITLE_KEYS | typeof BODY_KEYS,
  existing: TranslationMap,
): TranslationMap {
  const map: TranslationMap = { ...existing };
  for (const [dtoKey, lang] of keys) {
    const value = dto[dtoKey];
    if (value === undefined) continue;
    if (value.trim()) map[lang] = value.trim();
    else delete map[lang];
  }
  if (!map.ar || !map.en) {
    throw new BadRequestException({
      code: 'ANNOUNCEMENT_TRANSLATIONS_REQUIRED',
      message: 'Arabic and English title and body are required',
    });
  }
  return map;
}

export function mergeTitles(
  dto: TitleFields,
  existing: TranslationMap = {},
): TranslationMap {
  return merge(dto, TITLE_KEYS, existing);
}

export function mergeBodies(
  dto: BodyFields,
  existing: TranslationMap = {},
): TranslationMap {
  return merge(dto, BODY_KEYS, existing);
}

export function touchesTitles(dto: TitleFields): boolean {
  return TITLE_KEYS.some(([dtoKey]) => dto[dtoKey] !== undefined);
}

export function touchesBodies(dto: BodyFields): boolean {
  return BODY_KEYS.some(([dtoKey]) => dto[dtoKey] !== undefined);
}
