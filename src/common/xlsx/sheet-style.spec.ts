import ExcelJS from 'exceljs';
import { freezeAndFilterHeader, styleHeaderRow, XLSX_NAVY_ARGB, XLSX_WHITE_ARGB } from './sheet-style';

describe('sheet-style (Task B4a)', () => {
  describe('styleHeaderRow', () => {
    it('sets navy fill + white bold font on every cell in the row', () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Test');
      const row = sheet.addRow(['A', 'B', 'C']);

      styleHeaderRow(row);

      [1, 2, 3].forEach((col) => {
        const cell = row.getCell(col);
        expect(cell.fill).toEqual({
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: XLSX_NAVY_ARGB },
        });
        expect(cell.font).toEqual({ color: { argb: XLSX_WHITE_ARGB }, bold: true });
      });
    });
  });

  describe('freezeAndFilterHeader', () => {
    it('freezes row 1 and sets autoFilter to the exact range passed in', () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Test');

      freezeAndFilterHeader(sheet, 'A1:D1');

      expect(sheet.views).toEqual([{ state: 'frozen', ySplit: 1 }]);
      expect(sheet.autoFilter).toBe('A1:D1');
    });

    it('uses whatever range string is passed, not a hardcoded one', () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Test');

      freezeAndFilterHeader(sheet, 'A1:F1');

      expect(sheet.autoFilter).toBe('A1:F1');
    });
  });
});
