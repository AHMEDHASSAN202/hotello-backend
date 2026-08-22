import {
  BRAND_GOLD,
  BRAND_NAVY,
  CUT_GUIDE_COLOR,
  escapeHtml,
  fontFaceCss,
} from '../../tenant-rooms/pdf/print.constants';

export interface StickerData {
  qrDataUri: string;
  /** Spot number for a numbered series; null for the zone sticker. */
  spot: string | null;
}

export interface StickersData {
  hotelNameEn: string;
  hotelNameAr: string;
  logoDataUri: string | null;
  locationNameEn: string;
  locationNameAr: string;
  /** Spot label ("Umbrella" / "شمسية") — rendered beside the spot number. */
  spotLabelEn: string | null;
  spotLabelAr: string | null;
  stickers: StickerData[];
}

/** A8-ish stickers (52.5x74.25mm), 4x4 per A4 sheet — clean cut lines. */
const STICKERS_PER_SHEET = 8;
const STICKER_WIDTH_MM = 105;
const STICKER_HEIGHT_MM = 74.25;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function stickerHtml(data: StickersData, sticker: StickerData): string {
  const identity = data.logoDataUri
    ? `<img class="logo" src="${data.logoDataUri}" alt="${escapeHtml(data.hotelNameEn)}" />`
    : `<p class="hotel">${escapeHtml(data.hotelNameAr)} · ${escapeHtml(data.hotelNameEn)}</p>`;

  const spot =
    sticker.spot === null
      ? ''
      : `<p class="spot">
           <span class="spot-label" dir="rtl">${escapeHtml(data.spotLabelAr ?? '')}</span>
           <span class="spot-number">${escapeHtml(sticker.spot)}</span>
           <span class="spot-label">${escapeHtml(data.spotLabelEn ?? '')}</span>
         </p>`;

  return `
  <div class="sticker">
    <div class="text">
      ${identity}
      <p class="location" dir="rtl">${escapeHtml(data.locationNameAr)}</p>
      <p class="location">${escapeHtml(data.locationNameEn)}</p>
      ${spot}
      <p class="prompt" dir="rtl">امسح الرمز واطلب لمكانك</p>
      <p class="prompt">Scan to order to your spot</p>
    </div>
    <div class="qr"><img src="${sticker.qrDataUri}" alt="QR" /></div>
  </div>`;
}

/**
 * 16.3 AC2 — printable location stickers from the Epic 11 machinery: single
 * zone stickers or a numbered series ("Pool, spots 1–40"), 8 per A4 sheet
 * with dashed cut guides, room-card quality bar (navy/gold, Noto fonts,
 * bilingual lockup). Pure function; PdfRendererService renders it.
 */
export function stickerTemplate(data: StickersData): string {
  const sheets = chunk(data.stickers, STICKERS_PER_SHEET)
    .map((group, i) => {
      const pageBreak = i > 0 ? ' style="page-break-before: always;"' : '';
      return `<div class="sheet"${pageBreak}>${group
        .map((s) => stickerHtml(data, s))
        .join('\n')}</div>`;
    })
    .join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  ${fontFaceCss()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans', 'Noto Kufi Arabic', sans-serif; color: ${BRAND_NAVY}; }
  .sheet {
    width: 210mm;
    height: 297mm;
    display: grid;
    grid-template-columns: ${STICKER_WIDTH_MM}mm ${STICKER_WIDTH_MM}mm;
    grid-auto-rows: ${STICKER_HEIGHT_MM}mm;
    page-break-inside: avoid;
  }
  .sticker {
    width: ${STICKER_WIDTH_MM}mm;
    height: ${STICKER_HEIGHT_MM}mm;
    border: 1px dashed ${CUT_GUIDE_COLOR};
    display: flex;
    align-items: center;
    gap: 4mm;
    padding: 5mm 6mm;
    page-break-inside: avoid;
    border-inline-start: 2.5mm solid ${BRAND_GOLD};
  }
  .text { flex: 1; min-width: 0; }
  .logo { max-height: 8mm; max-width: 40mm; margin-bottom: 2mm; }
  .hotel { font-size: 3mm; font-weight: 600; margin-bottom: 2mm; color: ${BRAND_NAVY}; opacity: 0.75; }
  .location { font-size: 5.5mm; font-weight: 700; line-height: 1.25; }
  .spot { margin-top: 1.5mm; display: flex; align-items: baseline; gap: 2mm; }
  .spot-label { font-size: 3.2mm; font-weight: 600; opacity: 0.8; }
  .spot-number { font-size: 9mm; font-weight: 800; color: ${BRAND_GOLD}; }
  .prompt { margin-top: 1.5mm; font-size: 2.8mm; opacity: 0.8; }
  .qr { width: 34mm; height: 34mm; flex: none; }
  .qr img { width: 100%; height: 100%; }
</style>
</head>
<body>
${sheets}
</body>
</html>`;
}
