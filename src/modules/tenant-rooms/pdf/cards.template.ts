import {
  BRAND_GOLD,
  BRAND_NAVY,
  CUT_GUIDE_COLOR,
  escapeHtml,
  fontFaceCss,
  SCAN_PROMPT_LINES,
} from './print.constants';

export interface CardData {
  roomNumber: string;
  qrDataUri: string;
}

export interface CardsData {
  hotelNameEn: string;
  hotelNameAr: string;
  logoDataUri: string | null;
  cards: CardData[];
}

/** A6 (105x148mm) cards, 2x2 per A4 sheet — 297mm / 2 = 148.5mm tiles exactly. */
const CARDS_PER_SHEET = 4;
const CARD_WIDTH_MM = 105;
const CARD_HEIGHT_MM = 148.5;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function cardHtml(
  hotelNameEn: string,
  hotelNameAr: string,
  logoDataUri: string | null,
  card: CardData,
): string {
  const identity = logoDataUri
    ? `<img class="card-logo" src="${logoDataUri}" alt="${escapeHtml(hotelNameEn)}" />`
    : `<div class="card-identity">
         <span dir="rtl">${escapeHtml(hotelNameAr)}</span>
         <span>${escapeHtml(hotelNameEn)}</span>
       </div>`;

  const scanLines = SCAN_PROMPT_LINES.map(
    (line) =>
      `<p class="card-scan-line"${line.lang === 'ar' ? ' dir="rtl"' : ''} lang="${line.lang}">${escapeHtml(line.card)}</p>`,
  ).join('\n');

  return `
  <div class="card">
    ${identity}
    <p class="room-number">${escapeHtml(card.roomNumber)}</p>
    <div class="card-qr"><img src="${card.qrDataUri}" alt="QR" /></div>
    <div class="card-scan-lines">${scanLines}</div>
  </div>`;
}

/**
 * Story 11.5 AC2 — one printable sheet per 4 rooms: an A4 page laid out as a
 * 2x2 grid of A6 (105x148mm) cards with dashed cut guides, each card
 * carrying its room's QR, room number, and the hotel identity (logo, or the
 * bilingual name lockup when there's no logo). Pure function like
 * `posterTemplate` — the renderer (Playwright) is a separate concern.
 */
export function cardsTemplate(data: CardsData): string {
  const sheets = chunk(data.cards, CARDS_PER_SHEET)
    .map((group, i) => {
      const pageBreak = i > 0 ? ' style="page-break-before: always;"' : '';
      const cardsHtml = group
        .map((card) => cardHtml(data.hotelNameEn, data.hotelNameAr, data.logoDataUri, card))
        .join('\n');
      return `<div class="sheet"${pageBreak}>${cardsHtml}</div>`;
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
    grid-template-columns: ${CARD_WIDTH_MM}mm ${CARD_WIDTH_MM}mm;
    grid-template-rows: ${CARD_HEIGHT_MM}mm ${CARD_HEIGHT_MM}mm;
    page-break-inside: avoid;
  }
  .card {
    position: relative;
    width: ${CARD_WIDTH_MM}mm;
    height: ${CARD_HEIGHT_MM}mm;
    border: 1px dashed ${CUT_GUIDE_COLOR};
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6mm;
    text-align: center;
    page-break-inside: avoid;
  }
  .card-logo { max-height: 12mm; max-width: 70%; margin-bottom: 3mm; }
  .card-identity {
    font-weight: 700;
    font-size: 4mm;
    margin-bottom: 3mm;
    display: flex;
    flex-direction: column;
    gap: 1mm;
  }
  .room-number {
    font-family: 'Noto Sans', 'Noto Kufi Arabic', sans-serif;
    font-weight: 700;
    font-size: 13mm;
    color: ${BRAND_NAVY};
    margin: 2mm 0 4mm;
  }
  .card-qr {
    width: 45mm;
    height: 45mm;
    padding: 2mm;
    border: 0.5mm solid ${BRAND_GOLD};
    margin-bottom: 4mm;
  }
  .card-qr img { width: 100%; height: 100%; display: block; }
  .card-scan-lines { display: flex; flex-direction: column; gap: 1mm; }
  .card-scan-line { font-size: 2.4mm; line-height: 1.3; }
</style>
</head>
<body>
  ${sheets}
</body>
</html>`;
}
