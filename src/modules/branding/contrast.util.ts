/**
 * WCAG contrast math for the Guest App accent color (Epic 18, note 2).
 *
 * The one rule: an accent is allowed iff its contrast ratio against white is
 * at least 3:1. Guest surfaces are white/near-white and on-accent text is
 * white, so this single check covers both readability cases the spec names.
 */
export const MIN_ACCENT_CONTRAST = 3;
export const GXP_NAVY = '#0E2A47';
const WHITE = '#FFFFFF';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

function srgbChannel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function isAccentAllowed(hex: string): boolean {
  return isHexColor(hex) && contrastRatio(hex, WHITE) >= MIN_ACCENT_CONTRAST;
}

/**
 * Nearest passing variant: darken multiplicatively (hue-preserving) in 2%
 * steps until the accent passes. Degenerate input falls back to GXP navy.
 */
export function nearestSafeAccent(hex: string): string {
  if (!isHexColor(hex)) return GXP_NAVY;
  if (isAccentAllowed(hex)) return hex;
  const [r, g, b] = rgb(hex);
  for (let step = 1; step <= 50; step++) {
    const f = 1 - step * 0.02;
    const candidate =
      '#' +
      [r, g, b]
        .map((c) => Math.max(0, Math.round(c * f)).toString(16).padStart(2, '0'))
        .join('');
    if (isAccentAllowed(candidate)) return candidate;
  }
  return GXP_NAVY;
}
