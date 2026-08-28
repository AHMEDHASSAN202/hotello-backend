import { BadRequestException } from '@nestjs/common';
import {
  BodyFields,
  TitleFields,
  mergeBodies,
  mergeTitles,
  touchesBodies,
  touchesTitles,
} from './announcement-translations.util';

/**
 * 19.1 AC1 — title + body: AR + EN required, other 5 optional with EN
 * fallback (the fallback itself lives in localizeField; here we guarantee
 * the stored maps).
 */
describe('announcement translations util (19.1 AC1)', () => {
  it('merges flat title fields into a locale map', () => {
    expect(
      mergeTitles({ titleEn: ' Pool closed ', titleAr: 'المسبح مغلق', titleRu: 'Бассейн закрыт' }),
    ).toEqual({ en: 'Pool closed', ar: 'المسبح مغلق', ru: 'Бассейн закрыт' });
  });

  it('throws the stable code when AR or EN is missing', () => {
    expect(() => mergeTitles({ titleEn: 'Pool closed' })).toThrow(
      BadRequestException,
    );
    try {
      mergeTitles({ titleEn: 'Pool closed', titleAr: '  ' });
      fail('expected BadRequestException');
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'ANNOUNCEMENT_TRANSLATIONS_REQUIRED',
      });
    }
  });

  it('bodies carry the same AR+EN requirement', () => {
    expect(() => mergeBodies({ bodyAr: 'نص' })).toThrow(BadRequestException);
    expect(mergeBodies({ bodyEn: 'Body', bodyAr: 'نص' })).toEqual({
      en: 'Body',
      ar: 'نص',
    });
  });

  it('partial update merges over the existing map; clearing an optional locale removes it (EN fallback stays intact)', () => {
    const existing = { en: 'Old', ar: 'قديم', ru: 'Старый' };
    expect(mergeTitles({ titleRu: '' }, existing)).toEqual({
      en: 'Old',
      ar: 'قديم',
    });
    // Required locales can never be blanked, even via update.
    expect(() => mergeTitles({ titleEn: '' }, existing)).toThrow(
      BadRequestException,
    );
  });

  it('touch detection distinguishes titles from bodies', () => {
    expect(touchesTitles({ titleRu: 'x' })).toBe(true);
    expect(touchesTitles({ bodyEn: 'x' } as TitleFields)).toBe(false);
    expect(touchesBodies({ bodyDe: 'x' })).toBe(true);
    expect(touchesBodies({ titleEn: 'x' } as BodyFields)).toBe(false);
  });
});
