import { localizeField } from './requests.constants';

describe('localizeField (15.1 AC4 — the one guest-side fallback)', () => {
  const map = { ar: 'خدمة', en: 'Service', ru: 'Услуга' };

  it('returns the requested language when present', () => {
    expect(localizeField(map, 'ru')).toBe('Услуга');
    expect(localizeField(map, 'ar')).toBe('خدمة');
  });

  it('falls back to en for missing languages (custom items)', () => {
    expect(localizeField(map, 'de')).toBe('Service');
    expect(localizeField(map, 'it')).toBe('Service');
  });

  it('returns an empty string for null/undefined maps', () => {
    expect(localizeField(null, 'en')).toBe('');
    expect(localizeField(undefined, 'fr')).toBe('');
  });
});
