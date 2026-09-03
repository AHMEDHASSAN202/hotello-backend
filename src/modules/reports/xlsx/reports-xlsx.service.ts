import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { freezeAndFilterHeader, styleHeaderRow } from '../../../common/xlsx/sheet-style';
import { Hotel } from '../../hotels/hotel.entity';

export interface XlsxSheetSpec {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

@Injectable()
export class ReportsXlsxService {
  /**
   * Story 22.5 AC3 — a metadata block (hotel, period, generated-at, basis)
   * precedes the styled/frozen/filtered header on the FIRST sheet only;
   * additional sheets get just their own styled header (no repeated
   * metadata). `generatedAt` is passed in (not read from `new Date()` here)
   * so the caller controls it and tests stay deterministic.
   */
  async build(
    hotel: Pick<Hotel, 'nameEn' | 'nameAr' | 'timezone'>,
    period: { from: string; to: string },
    generatedAt: Date,
    basisLine: string,
    sheets: XlsxSheetSpec[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    sheets.forEach((spec, i) => {
      const sheet = workbook.addWorksheet(spec.name);
      let headerRowIndex = 1;
      if (i === 0) {
        sheet.addRow([hotel.nameEn || hotel.nameAr]);
        sheet.addRow([`Period: ${period.from} to ${period.to}`]);
        sheet.addRow([`Generated: ${generatedAt.toISOString()}`]);
        sheet.addRow([basisLine]);
        sheet.addRow([]);
        headerRowIndex = 6;
      }
      const headerRow = sheet.addRow(spec.headers);
      styleHeaderRow(headerRow);
      for (const row of spec.rows) sheet.addRow(row);
      const lastCol = String.fromCharCode(64 + spec.headers.length); // 'A'..'Z', headers.length <= 26 for every report here
      freezeAndFilterHeader(sheet, `A${headerRowIndex}:${lastCol}${headerRowIndex}`);
      // freezeAndFilterHeader hardcodes ySplit:1 (correct when the header is
      // row 1, i.e. every sheet but the first) — override for the first
      // sheet, whose header sits at row 6 below the metadata block, so the
      // freeze pane actually ends at the header row instead of row 1.
      sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];
    });
    return workbook.xlsx.writeBuffer() as unknown as Buffer;
  }
}
