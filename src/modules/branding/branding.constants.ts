import { TranslationMap } from '../requests/requests.constants';

export const BRANDING_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const BRANDING_COVER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** Wide renditions — thumb for the dashboard preview, detail for the guest header. */
export const COVER_THUMB = { width: 640, height: 360 };
export const COVER_DETAIL = { width: 1440, height: 810 };
export const WELCOME_MAX_LENGTH = 80;

export interface BrandingManageView {
  brandAccentColor: string | null;
  coverThumbUrl: string | null;
  coverDetailUrl: string | null;
  welcomeMessage: TranslationMap | null;
}
