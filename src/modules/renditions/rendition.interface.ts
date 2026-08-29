/**
 * Story 21.1 AC1 — shared photo-rendition pipeline. A preset describes the
 * fixed set of derived WebP sizes a feature needs (e.g. `thumb` + `detail`);
 * every consumer (F&B, Hotel Info, Branding, Events) declares its own preset
 * as a constant, never inline dimensions.
 */
export interface RenditionSpec {
  width: number;
  height: number;
  fit: 'cover' | 'inside';
  quality: number;
  withoutEnlargement?: boolean;
}

export type RenditionPreset = Record<string, RenditionSpec>;
