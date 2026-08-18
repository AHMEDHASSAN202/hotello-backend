import { join } from 'path';

/** Brand colors (global constraint) — navy header/text, gold accents. */
export const BRAND_NAVY = '#0E2A47';
export const BRAND_GOLD = '#C8A24A';
/** Cut-guide dashed border on room cards — a quiet neutral, not brand navy/gold. */
export const CUT_GUIDE_COLOR = '#C8C2B8';

export type ScanPromptLang = 'ar' | 'en' | 'ru' | 'de' | 'fr';

export interface ScanPromptLine {
  lang: ScanPromptLang;
  /** Full-length line for the poster (AC1). */
  poster: string;
  /** Shorter line for the small room card (AC2) — same meaning, less real estate. */
  card: string;
}

/**
 * Story 11.5 (note 7) — the single source of the guest-facing "scan to
 * continue" copy in every language the poster/cards must speak. Per the
 * backend's print/xlsx convention, this is a typed TS constant, not an i18n
 * file. Fixed AR→EN→RU→DE→FR order on every artifact (print-stable — the
 * ordering never depends on the viewer).
 */
export const SCAN_PROMPT_LINES: ScanPromptLine[] = [
  {
    lang: 'ar',
    poster: 'امسح رمز الاستجابة السريعة للوصول إلى خدمات الضيافة',
    card: 'امسح للوصول إلى الخدمات',
  },
  {
    lang: 'en',
    poster: 'Scan the QR code to access hotel guest services',
    card: 'Scan for guest services',
  },
  {
    lang: 'ru',
    poster: 'Отсканируйте QR-код, чтобы получить доступ к услугам для гостей',
    card: 'Сканируйте для услуг',
  },
  {
    lang: 'de',
    poster: 'Scannen Sie den QR-Code, um auf die Gästeservices zuzugreifen',
    card: 'Scannen für Gästeservice',
  },
  {
    lang: 'fr',
    poster: "Scannez le code QR pour accéder aux services de l'hôtel",
    card: 'Scannez pour les services',
  },
];

const FONT_FILES = {
  sansRegular: 'NotoSans-Regular.ttf',
  sansBold: 'NotoSans-Bold.ttf',
  arabicRegular: 'NotoKufiArabic-Regular.ttf',
  arabicBold: 'NotoKufiArabic-Bold.ttf',
} as const;

/**
 * Absolute `file://` URL Chromium can load with no network access — the
 * templates must render fully offline (no CDN fonts, no remote images).
 * Resolved relative to `process.cwd()` (repo root when the app runs), not
 * `__dirname`, matching the brief's exact instruction.
 */
function fontFileUrl(filename: string): string {
  return `file://${join(process.cwd(), 'assets/fonts', filename)}`;
}

/** Shared `@font-face` block — every PDF template embeds both Noto families. */
export function fontFaceCss(): string {
  return `
    @font-face {
      font-family: 'Noto Sans';
      src: url('${fontFileUrl(FONT_FILES.sansRegular)}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'Noto Sans';
      src: url('${fontFileUrl(FONT_FILES.sansBold)}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
    @font-face {
      font-family: 'Noto Kufi Arabic';
      src: url('${fontFileUrl(FONT_FILES.arabicRegular)}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'Noto Kufi Arabic';
      src: url('${fontFileUrl(FONT_FILES.arabicBold)}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
  `;
}

/**
 * Escapes text interpolated into the templates — hotel names and room
 * numbers are tenant-controlled strings and must not break out of the HTML
 * text nodes they're placed in.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
