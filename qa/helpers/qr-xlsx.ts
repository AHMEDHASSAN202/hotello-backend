/**
 * Decode a QR PNG to its payload (Story 11.5 AC4 — QRs must encode the exact
 * derived guest URL) and read workbook structure for the Excel suite.
 */
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import ExcelJS from 'exceljs';

export async function decodeQrPng(png: Buffer): Promise<string> {
  const pngImage = PNG.sync.read(png);
  const result = jsQR(
    new Uint8ClampedArray(pngImage.data),
    pngImage.width,
    pngImage.height,
  );
  if (!result) throw new Error('QR PNG could not be decoded');
  return result.data;
}

export async function readWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return wb;
}

/** Cell comment/note text on a header cell (Story 11.7 AC2), or null. */
export function headerNote(
  wb: ExcelJS.Workbook,
  worksheet: string,
  cell: string,
): string | null {
  const ws = wb.getWorksheet(worksheet);
  if (!ws) return null;
  const note = ws.getCell(cell).note;
  if (note === undefined || note === null) return null;
  if (typeof note === 'string') return note;
  return (note.texts ?? []).map((t) => t.text).join('');
}
