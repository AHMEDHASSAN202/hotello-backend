import ExcelJS from 'exceljs';
import { Hotel } from '../../hotels/hotel.entity';
import { ReportsXlsxService, XlsxSheetSpec } from './reports-xlsx.service';

/** Round-trips a buffer through exceljs the way a real consumer (Excel, a test) would read it back. */
async function reload(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

const HOTEL: Pick<Hotel, 'nameEn' | 'nameAr' | 'timezone'> = {
  nameEn: 'Sunrise Hotel',
  nameAr: 'فندق شروق',
  timezone: 'Africa/Cairo',
};
const PERIOD = { from: '2026-03-01', to: '2026-03-07' };
const GENERATED_AT = new Date('2026-03-08T10:00:00Z');
const BASIS_LINE = 'Basis: delivered orders only';

describe('ReportsXlsxService (Story 22.5 AC3)', () => {
  let service: ReportsXlsxService;

  beforeEach(() => {
    service = new ReportsXlsxService();
  });

  it('single-sheet workbook has the metadata block (4 rows + 1 blank) before the styled header', async () => {
    const sheets: XlsxSheetSpec[] = [
      { name: 'Totals by day', headers: ['Date', 'Total'], rows: [['2026-03-01', 100]] },
    ];

    const buffer = await service.build(HOTEL, PERIOD, GENERATED_AT, BASIS_LINE, sheets);
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet('Totals by day')!;

    expect(sheet.getCell('A1').value).toBe('Sunrise Hotel');
    expect(sheet.getCell('A2').value).toBe('Period: 2026-03-01 to 2026-03-07');
    expect(sheet.getCell('A3').value).toBe(`Generated: ${GENERATED_AT.toISOString()}`);
    expect(sheet.getCell('A4').value).toBe(BASIS_LINE);
    expect(sheet.getCell('A5').value).toBeNull();
    // header row is row 6
    expect(sheet.getCell('A6').value).toBe('Date');
    expect(sheet.getCell('B6').value).toBe('Total');
    // data row is row 7
    expect(sheet.getCell('A7').value).toBe('2026-03-01');
    expect(sheet.getCell('B7').value).toBe(100);
  });

  it('falls back to nameAr when nameEn is falsy', async () => {
    const sheets: XlsxSheetSpec[] = [{ name: 'S', headers: ['H'], rows: [] }];

    const buffer = await service.build(
      { nameEn: '', nameAr: 'فندق شروق', timezone: 'Africa/Cairo' },
      PERIOD,
      GENERATED_AT,
      BASIS_LINE,
      sheets,
    );
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet('S')!;

    expect(sheet.getCell('A1').value).toBe('فندق شروق');
  });

  it("a multi-sheet workbook's SECOND sheet has no metadata block, header starts at row 1", async () => {
    const sheets: XlsxSheetSpec[] = [
      { name: 'First', headers: ['A'], rows: [['x']] },
      { name: 'Second', headers: ['B', 'C'], rows: [['y', 'z']] },
    ];

    const buffer = await service.build(HOTEL, PERIOD, GENERATED_AT, BASIS_LINE, sheets);
    const workbook = await reload(buffer);
    const second = workbook.getWorksheet('Second')!;

    expect(second.getCell('A1').value).toBe('B');
    expect(second.getCell('B1').value).toBe('C');
    expect(second.getCell('A2').value).toBe('y');
    expect(second.getCell('B2').value).toBe('z');
  });

  it('the header row has the navy/white styling', async () => {
    const sheets: XlsxSheetSpec[] = [{ name: 'First', headers: ['A'], rows: [] }];

    const buffer = await service.build(HOTEL, PERIOD, GENERATED_AT, BASIS_LINE, sheets);
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet('First')!;
    const headerCell = sheet.getCell('A6');

    expect(headerCell.fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0E2A47' },
    });
    expect(headerCell.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } });
  });

  it('the workbook has the right number of sheets, named correctly', async () => {
    const sheets: XlsxSheetSpec[] = [
      { name: 'Alpha', headers: ['A'], rows: [] },
      { name: 'Beta', headers: ['B'], rows: [] },
      { name: 'Gamma', headers: ['C'], rows: [] },
    ];

    const buffer = await service.build(HOTEL, PERIOD, GENERATED_AT, BASIS_LINE, sheets);
    const workbook = await reload(buffer);

    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('freezes the FIRST sheet at the header row (row 6), not row 1', async () => {
    const sheets: XlsxSheetSpec[] = [
      { name: 'First', headers: ['A'], rows: [['x']] },
      { name: 'Second', headers: ['B'], rows: [['y']] },
    ];

    const buffer = await service.build(HOTEL, PERIOD, GENERATED_AT, BASIS_LINE, sheets);
    const workbook = await reload(buffer);
    const first = workbook.getWorksheet('First')!;
    const second = workbook.getWorksheet('Second')!;

    expect(first.views[0]).toMatchObject({ state: 'frozen', ySplit: 6 });
    expect(first.autoFilter).toBe('A6:A6');
    // The second sheet has no metadata block, so ySplit:1 (header at row 1) is correct.
    expect(second.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(second.autoFilter).toBe('A1:A1');
  });
});
