import { TranslationMap } from '../requests/requests.constants';
import { RenditionPreset } from '../renditions/rendition.interface';

export const BRANDING_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const BRANDING_COVER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/**
 * Wide renditions — thumb for the dashboard preview, detail for the guest
 * header. Both dims use `fit: 'cover'` (unlike F&B/Hotel-Info's `detail`
 * using `'inside'`) — intentional, do not normalize away.
 */
export const BRANDING_COVER_PRESET: RenditionPreset = {
  thumb: { width: 640, height: 360, fit: 'cover', quality: 82 },
  detail: { width: 1440, height: 810, fit: 'cover', quality: 82 },
};
export const WELCOME_MAX_LENGTH = 80;

export interface BrandingManageView {
  brandAccentColor: string | null;
  coverThumbUrl: string | null;
  coverDetailUrl: string | null;
  welcomeMessage: TranslationMap | null;
}
