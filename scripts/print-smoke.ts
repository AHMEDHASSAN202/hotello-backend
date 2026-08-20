/**
 * Print smoke check for Story 11.5 PDFs — renders the poster (A4/A5, with and
 * without a logo) and the room-cards sheet through real Chromium and asserts
 * every artifact is exactly one page per sheet. Run with:
 *   npx ts-node -T scripts/print-smoke.ts
 * Writes the PDFs to /tmp/hotello-print-smoke/ for eyeballing.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as QRCode from 'qrcode';
import { posterTemplate } from '../src/modules/tenant-rooms/pdf/poster.template';
import { cardsTemplate } from '../src/modules/tenant-rooms/pdf/cards.template';
import { PdfRendererService } from '../src/modules/tenant-rooms/pdf/pdf-renderer.service';

const OUT_DIR = '/tmp/hotello-print-smoke';

// Tall-ish square logo — worst case for the poster header (max-height wins).
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" rx="36" fill="#0E2A47"/><text x="100" y="125" font-size="72" text-anchor="middle" fill="#C8A24A" font-family="sans-serif">GH</text></svg>`;
const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

function pageCount(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const qrDataUri = await QRCode.toDataURL('https://guest.gxp.example/sunrise?room=100', {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });

  const renderer = new PdfRendererService();
  const hotel = { hotelNameEn: 'Grand Horizon Hotel', hotelNameAr: 'فندق الأفق الكبير' };
  const failures: string[] = [];

  const posterCases: Array<{ name: string; size: 'A4' | 'A5'; logo: string | null }> = [
    { name: 'poster-a4-logo', size: 'A4', logo: LOGO_DATA_URI },
    { name: 'poster-a4-lockup', size: 'A4', logo: null },
    { name: 'poster-a5-logo', size: 'A5', logo: LOGO_DATA_URI },
    { name: 'poster-a5-lockup', size: 'A5', logo: null },
  ];
  for (const c of posterCases) {
    const html = posterTemplate({ ...hotel, logoDataUri: c.logo, qrDataUri, size: c.size });
    const pdf = await renderer.render(html, { format: c.size });
    writeFileSync(join(OUT_DIR, `${c.name}.pdf`), pdf);
    const pages = pageCount(pdf);
    console.log(`${c.name}: ${pages} page(s)`);
    if (pages !== 1) failures.push(`${c.name} rendered ${pages} pages (want 1)`);
  }

  const cardCases = [
    { name: 'cards-1-room', rooms: ['100'] },
    { name: 'cards-4-rooms', rooms: ['100', '101', '102', '103'] },
    { name: 'cards-5-rooms', rooms: ['100', '101', '102', '103', '104'] },
  ];
  for (const c of cardCases) {
    const cards = await Promise.all(
      c.rooms.map(async (roomNumber) => ({
        roomNumber,
        qrDataUri: await QRCode.toDataURL(`https://guest.gxp.example/sunrise?room=${roomNumber}`, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 512,
        }),
      })),
    );
    const html = cardsTemplate({ ...hotel, logoDataUri: LOGO_DATA_URI, cards });
    const pdf = await renderer.render(html, { format: 'A4' });
    writeFileSync(join(OUT_DIR, `${c.name}.pdf`), pdf);
    const pages = pageCount(pdf);
    const want = Math.ceil(c.rooms.length / 4);
    console.log(`${c.name}: ${pages} page(s), want ${want}`);
    if (pages !== want) failures.push(`${c.name} rendered ${pages} pages (want ${want})`);
  }

  await renderer.onModuleDestroy();
  if (failures.length) {
    console.error(`\nFAIL:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\nAll print artifacts are the expected page count.');
}

void main();
