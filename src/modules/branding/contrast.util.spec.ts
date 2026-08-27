import {
  contrastRatio,
  isAccentAllowed,
  isHexColor,
  nearestSafeAccent,
  relativeLuminance,
} from './contrast.util';

describe('contrast.util (Epic 18, note 2)', () => {
  it('computes known WCAG contrast pairs', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // Published reference values (webaim): red 4.0, blue 8.59, green 1.37 vs white.
    expect(contrastRatio('#FF0000', '#FFFFFF')).toBeCloseTo(4.0, 1);
    expect(contrastRatio('#0000FF', '#FFFFFF')).toBeCloseTo(8.59, 1);
    expect(contrastRatio('#00FF00', '#FFFFFF')).toBeCloseTo(1.37, 1);
  });

  it('is symmetric in its arguments', () => {
    expect(contrastRatio('#123456', '#FEDCBA')).toBeCloseTo(
      contrastRatio('#FEDCBA', '#123456'),
      10,
    );
  });

  it('computes relative luminance extremes', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('allows the GXP navy and other dark accents (>= 3:1 vs white)', () => {
    expect(isAccentAllowed('#0E2A47')).toBe(true); // GXP navy
    expect(isAccentAllowed('#B3402A')).toBe(true); // danger red
    expect(isAccentAllowed('#0F6B5C')).toBe(true); // demo teal
  });

  it('blocks unreadable light accents (< 3:1 vs white)', () => {
    expect(isAccentAllowed('#FFFF00')).toBe(false); // yellow ~1.07
    expect(isAccentAllowed('#FFA500')).toBe(false); // orange ~2.14
    expect(isAccentAllowed('#FFFFFF')).toBe(false);
  });

  it('rejects malformed hex inputs', () => {
    expect(isHexColor('#FFF')).toBe(false);
    expect(isHexColor('0E2A47')).toBe(false);
    expect(isHexColor('#GGGGGG')).toBe(false);
    expect(isHexColor('#0E2A47')).toBe(true);
    expect(isAccentAllowed('nonsense')).toBe(false);
  });

  it('suggests a nearest darker variant that passes, preserving format', () => {
    const suggestion = nearestSafeAccent('#FFA500');
    expect(suggestion).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(isAccentAllowed(suggestion)).toBe(true);
    // Already-safe colors come back unchanged.
    expect(nearestSafeAccent('#0E2A47')).toBe('#0E2A47');
  });

  it('falls back to GXP navy for degenerate inputs', () => {
    expect(nearestSafeAccent('not-a-color')).toBe('#0E2A47');
  });
});
