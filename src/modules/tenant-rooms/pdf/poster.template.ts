import {
  BRAND_GOLD,
  BRAND_NAVY,
  escapeHtml,
  fontFaceCss,
  SCAN_PROMPT_LINES,
} from './print.constants';

export interface PosterData {
  hotelNameEn: string;
  hotelNameAr: string;
  logoDataUri: string | null;
  qrDataUri: string;
  size: 'A4' | 'A5';
}

/**
 * Every dimension the poster uses, scaled per sheet size. A5 (148x210mm) is
 * roughly half of A4 (210x297mm) — sizing the QR/header/text at A4 scale on
 * an A5 sheet overflows onto a second page (caught by the Task 9 manual
 * print check: `page.pdf()` returned 2 pages for A5 before this existed).
 * Every value here is tuned so the poster's content height stays comfortably
 * under each sheet's height with margin to spare.
 */
const POSTER_DIMENSIONS: Record<
  PosterData['size'],
  {
    headerPadding: string;
    logoMaxHeight: string;
    lockupFontSize: string;
    lockupGap: string;
    qrSize: string;
    qrWrapPadding: string;
    qrWrapMarginTop: string;
    captionMarginTop: string;
    captionFontSize: string;
    scanLinesMarginTop: string;
    scanLineFontSize: string;
    scanLinesGap: string;
    footerPadding: string;
    footerFontSize: string;
  }
> = {
  A4: {
    headerPadding: '20mm 12mm',
    logoMaxHeight: '32mm',
    lockupFontSize: '9mm',
    lockupGap: '4mm',
    qrSize: '90mm',
    qrWrapPadding: '8mm',
    qrWrapMarginTop: '16mm',
    captionMarginTop: '8mm',
    captionFontSize: '5.5mm',
    scanLinesMarginTop: '12mm',
    scanLineFontSize: '5mm',
    scanLinesGap: '3mm',
    footerPadding: '10mm',
    footerFontSize: '3.5mm',
  },
  A5: {
    headerPadding: '10mm 8mm',
    logoMaxHeight: '18mm',
    lockupFontSize: '6mm',
    lockupGap: '2.5mm',
    qrSize: '58mm',
    qrWrapPadding: '4mm',
    qrWrapMarginTop: '8mm',
    captionMarginTop: '5mm',
    captionFontSize: '4mm',
    scanLinesMarginTop: '6mm',
    scanLineFontSize: '3mm',
    scanLinesGap: '1.5mm',
    footerPadding: '5mm',
    footerFontSize: '2.5mm',
  },
};

/**
 * Story 11.5 AC1 — the reception poster: navy header band (hotel logo, or a
 * bilingual name lockup when there's no logo yet), the guest-app QR on white
 * with a gold rule, the five-language scan prompt, and a quiet "Powered by
 * GXP" footer. A pure function — same input always renders the same HTML, so
 * it's fast to unit-test with no browser involved (the renderer is a
 * separate concern).
 */
export function posterTemplate(data: PosterData): string {
  const dims = POSTER_DIMENSIONS[data.size];
  const headerContent = data.logoDataUri
    ? `<img class="logo" src="${data.logoDataUri}" alt="${escapeHtml(data.hotelNameEn)}" />`
    : `<div class="lockup">
         <span dir="rtl">${escapeHtml(data.hotelNameAr)}</span>
         <span>${escapeHtml(data.hotelNameEn)}</span>
       </div>`;

  const scanLines = SCAN_PROMPT_LINES.map(
    (line) =>
      `<p class="scan-line"${line.lang === 'ar' ? ' dir="rtl"' : ''} lang="${line.lang}">${escapeHtml(line.poster)}</p>`,
  ).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${data.size}; margin: 0; }
  ${fontFaceCss()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: 'Noto Sans', 'Noto Kufi Arabic', sans-serif;
    color: ${BRAND_NAVY};
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .header {
    width: 100%;
    background: ${BRAND_NAVY};
    color: #ffffff;
    padding: ${dims.headerPadding};
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .logo { max-height: ${dims.logoMaxHeight}; max-width: 80%; }
  .lockup {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${dims.lockupGap};
    font-weight: 700;
    font-size: ${dims.lockupFontSize};
    text-align: center;
  }
  .qr-wrap {
    margin-top: ${dims.qrWrapMarginTop};
    padding: ${dims.qrWrapPadding};
    background: #ffffff;
    border: 1mm solid ${BRAND_GOLD};
    border-radius: 4mm;
  }
  .qr-wrap img { width: ${dims.qrSize}; height: ${dims.qrSize}; display: block; }
  .hotel-caption {
    margin-top: ${dims.captionMarginTop};
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5mm;
    font-weight: 700;
    font-size: ${dims.captionFontSize};
  }
  .scan-lines {
    margin-top: ${dims.scanLinesMarginTop};
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${dims.scanLinesGap};
  }
  .scan-line { font-size: ${dims.scanLineFontSize}; }
  .footer { margin-top: auto; padding: ${dims.footerPadding}; font-size: ${dims.footerFontSize}; color: #6b7280; }
</style>
</head>
<body>
  <div class="header">${headerContent}</div>
  <div class="qr-wrap"><img src="${data.qrDataUri}" alt="QR" /></div>
  <div class="hotel-caption">
    <span dir="rtl">${escapeHtml(data.hotelNameAr)}</span>
    <span>${escapeHtml(data.hotelNameEn)}</span>
  </div>
  <div class="scan-lines">${scanLines}</div>
  <div class="footer">Powered by GXP</div>
</body>
</html>`;
}
