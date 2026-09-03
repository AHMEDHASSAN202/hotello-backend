import ExcelJS from 'exceljs';

/**
 * Story 22.5 (Task B4a) — extracted from the Epic 11 rooms xlsx service so
 * every generated xlsx sheet in this repo (rooms export/template, Epic 22
 * reports) shares one definition of the brand header styling instead of
 * duplicating it.
 */

/** Brand navy header fill / white header text — ARGB (exceljs fill/font format). Shared by every generated xlsx sheet in this repo (rooms export/template, Epic 22 reports). */
export const XLSX_NAVY_ARGB = 'FF0E2A47';
export const XLSX_WHITE_ARGB = 'FFFFFFFF';

/** Styled header row: navy fill, white bold text. */
export function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_NAVY_ARGB } };
    cell.font = { color: { argb: XLSX_WHITE_ARGB }, bold: true };
  });
}

/** Freeze the header row (row 1) and enable auto-filter across `headerRange` (e.g. `'A1:D1'`). */
export function freezeAndFilterHeader(sheet: ExcelJS.Worksheet, headerRange: string): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = headerRange;
}
