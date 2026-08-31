/**
 * Epic 11 — Story 11.7 Excel Export & Annotated Import Template.
 *
 * Number range 8xx, floors 2/12 (reserved for this suite in the shared
 * worker hotel); isolation-sensitive cases use their own hotel.
 */
import { expect, test } from '../../fixtures';
import {
  apiGetRaw,
  apiPost,
  apiPostForm,
  createPlan,
  listRooms,
  provisionHotel,
  standardTypeId,
} from '../../helpers/gxp-api';
import { readWorkbook, headerNote } from '../../helpers/qr-xlsx';
import type ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

function sheetXml(xlsx: Buffer): string {
  const tmp = path.join(tmpdir(), `gxp-qa-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  fs.writeFileSync(tmp, xlsx);
  try {
    return execFileSync('unzip', ['-p', tmp], { encoding: 'utf8', maxBuffer: 10 << 20 });
  } finally {
    fs.unlinkSync(tmp);
  }
}

async function importFile(rows: (string[] | null)[]): Promise<{
  name: string;
  mimeType: string;
  buffer: Buffer;
}> {
  return {
    name: 'rooms.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildImportXlsx(rows),
  };
}

/**
 * Build an import-shaped workbook (template-style headers + data rows).
 * Room numbers are written as TEXT the way the template instructs; null
 * rows become fully blank lines.
 */
async function buildImportXlsx(dataRows: (string[] | null)[]): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.default.Workbook();
  const ws = wb.addWorksheet('Rooms');
  ws.addRow(['Room Number', 'Floor', 'Type', 'Status']);
  for (const row of dataRows) {
    const added = ws.addRow(row ?? []);
    if (row) {
      added.getCell(1).numFmt = '@';
      added.getCell(1).value = row[0];
    }
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

test('11.7 AC1 — export downloads the current rooms as .xlsx with the right columns', async ({
  request,
  hotel,
  standardType,
}) => {
  await create8xx(request, hotel.ownerToken, standardType.id, [
    ['801', 2, 'active'],
    ['802', 2, 'active'],
    ['803', 12, 'out_of_service'],
  ]);

  const res = await apiGetRaw(request, '/tenant/rooms/export?search=80', hotel.ownerToken);
  expect(res.status).toBe(200);
  expect(res.contentType).toContain('spreadsheetml');

  const wb = await readWorkbook(res.body);
  const ws = (wb.getWorksheet('Rooms') ?? wb.worksheets[0])!;
  const headerTexts = [1, 2, 3, 4].map((c) => ws.getRow(1).getCell(c).text);
  expect(headerTexts).toEqual(['Room Number', 'Floor', 'Type', 'Status']);

  const numbers: string[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    numbers.push(row.getCell(1).text);
  });
  expect(numbers.sort()).toEqual(['801', '802', '803']);
});

test('11.7 AC1 — export respects the active list filters', async ({
  request,
  hotel,
  standardType,
}) => {
  await create8xx(request, hotel.ownerToken, standardType.id, [
    ['841', 2, 'active'],
    ['842', 2, 'active'],
    ['843', 12, 'active'],
  ]);

  // Combined filters: only the floor-2 rooms of this self-contained set.
  const res = await apiGetRaw(request, '/tenant/rooms/export?floor=2&search=84', hotel.ownerToken);
  const wb = await readWorkbook(res.body);
  const ws = (wb.getWorksheet('Rooms') ?? wb.worksheets[0])!;
  const numbers: string[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    numbers.push(row.getCell(1).text);
  });
  expect(numbers.sort()).toEqual(['841', '842']);
});

test('11.7 AC1 — export header is styled navy, frozen and auto-filtered', async ({
  request,
  hotel,
  standardType,
}) => {
  await create8xx(request, hotel.ownerToken, standardType.id, [['807', 12, 'active']]);
  const res = await apiGetRaw(request, '/tenant/rooms/export', hotel.ownerToken);
  const wb = await readWorkbook(res.body);
  const ws = (wb.getWorksheet('Rooms') ?? wb.worksheets[0])!;

  const header = ws.getRow(1).getCell(1);
  expect((header.fill as ExcelJS.FillPattern).fgColor?.argb).toContain('0E2A47');

  // Frozen header row.
  expect(ws.views).toEqual([expect.objectContaining({ state: 'frozen', ySplit: 1 })]);

  const raw = sheetXml(res.body);
  expect(raw).toContain('autoFilter');
});

test('11.7 AC2 — template carries a note on every input column (EN hotel)', async ({
  request,
  hotel,
}) => {
  const res = await apiGetRaw(request, '/tenant/rooms/import/template', hotel.ownerToken);
  expect(res.status).toBe(200);
  const wb = await readWorkbook(res.body);
  const ws = (wb.getWorksheet('Rooms') ?? wb.worksheets[0])!;

  for (const cell of ['A1', 'B1', 'C1', 'D1']) {
    expect(headerNote(wb, ws.name, cell), `note on ${cell}`).toBeTruthy();
  }
  const numberNote = headerNote(wb, ws.name, 'A1')!;
  expect(numberNote).toContain('Required');
  expect(numberNote).toContain('#');
  expect(headerNote(wb, ws.name, 'B1')).toContain('Optional');
});

test('11.7 AC2 — template notes follow the hotel default_language (AR hotel)', async ({
  request,
  adminToken,
}) => {
  const arHotel = await provisionHotel(request, {
    epic: 'e11',
    tag: `ar${Date.now().toString(36)}`,
    defaultLanguage: 'ar',
    adminToken,
  });
  const res = await apiGetRaw(request, '/tenant/rooms/import/template', arHotel.ownerToken);
  const wb = await readWorkbook(res.body);
  const ws = wb.worksheets[0]!;
  expect(ws.name).toBe('الغرف');
  const headerTexts = [1, 2, 3, 4].map((c) => ws.getRow(1).getCell(c).text);
  expect(headerTexts).toEqual(['رقم الغرفة', 'الطابق', 'النوع', 'الحالة']);
  const note = headerNote(wb, ws.name, 'A1')!;
  expect(note).toContain('مطلوب');
});

test('11.7 AC3 — template dropdowns list the hotel types; example rows carry #', async ({
  request,
  hotel,
}) => {
  const res = await apiGetRaw(request, '/tenant/rooms/import/template', hotel.ownerToken);
  const raw = sheetXml(res.body);

  expect(raw).toContain('dataValidation');
  expect(raw).toContain('active,out_of_service');
  expect(raw).toContain('Standard');

  const wb = await readWorkbook(res.body);
  const ws = (wb.getWorksheet('Rooms') ?? wb.worksheets[0])!;
  const exampleNumbers: string[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const v = row.getCell(1).text;
    if (v) exampleNumbers.push(v);
  });
  expect(exampleNumbers.filter((n) => n.startsWith('#'))).toHaveLength(3);
});

test('11.7 AC4 — import preview reports per-row errors (unknown type, bad status, empty)', async ({
  request,
  hotel,
}) => {
  const preview = await apiPostForm(request, '/tenant/rooms/import/preview', {
    multipart: {
      file: await importFile([
        ['811', '2', 'Standard', 'active'],
        ['812', '2', 'NoSuchType', 'active'],
        ['813', '2', 'Standard', 'demolished'],
        ['', '2', 'Standard', 'active'],
        ['811', '12', 'Standard', 'active'], // duplicate within the file
      ]),
    },
  }, hotel.ownerToken);
  expect(preview.status).toBe(200);

  const rows = preview.body.rows as Array<{
    row: number;
    issues: Array<{ field: string; code: string }>;
  }>;
  const byRow = Object.fromEntries(rows.map((r) => [r.row, r.issues.map((i) => i.code)]));
  // Spreadsheet row 1 is the header; data starts at row 2.
  expect(byRow[2], 'first data row is valid').toHaveLength(0);
  expect(byRow[3]).toContain('UNKNOWN_TYPE');
  expect(byRow[4]).toContain('INVALID_STATUS');
  expect(byRow[5]).toContain('REQUIRED');
  expect(byRow[6]).toContain('DUPLICATE_IN_FILE');
  expect(preview.body.invalidCount).toBe(4);
  expect(preview.body.validCount).toBe(1);
});

test('11.7 AC4 — import commit creates the valid rows through the shared bulk endpoint', async ({
  request,
  hotel,
  standardType,
}) => {
  const commit = await apiPost(request, '/tenant/rooms/bulk', {
    source: 'import',
    skipDuplicates: true,
    skippedCount: 1,
    rooms: [
      { row: 2, roomNumber: '821', floor: 2, roomTypeId: standardType.id, status: 'active' },
    ],
  }, hotel.ownerToken);
  expect(commit.status).toBe(201);
  expect(commit.body).toMatchObject({ created: 1, skipped: 0 });

  const list = await listRooms(request, hotel.ownerToken, { search: '821' });
  expect(list.body.data.map((r) => r.roomNumber)).toEqual(['821']);
});

test('11.7 AC4 — the import commit still enforces the plan limit atomically', async ({
  request,
  adminToken,
}) => {
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA Import 1 ${Date.now().toString(36)}`,
    maxRooms: 1,
  });
  const tiny = await provisionHotel(request, { epic: 'e11', tag: `iml${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, tiny.ownerToken);

  const commit = await apiPost(request, '/tenant/rooms/bulk', {
    source: 'import',
    rooms: [
      { row: 2, roomNumber: '901', roomTypeId: type },
      { row: 3, roomNumber: '902', roomTypeId: type },
    ],
  }, tiny.ownerToken);
  expect(commit.status).toBe(409);
  expect(commit.body.code).toBe('ROOM_LIMIT_REACHED');
  const list = await listRooms(request, tiny.ownerToken);
  expect(list.body.total).toBe(0);
});

test('11.7 AC4 — an untouched template previews as 3 skipped example rows, 0 valid', async ({
  request,
  hotel,
}) => {
  const template = await apiGetRaw(request, '/tenant/rooms/import/template', hotel.ownerToken);
  const preview = await apiPostForm(request, '/tenant/rooms/import/preview', {
    multipart: {
      file: {
        name: 'template.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: template.body,
      },
    },
  }, hotel.ownerToken);
  expect(preview.status).toBe(200);
  expect(preview.body.validCount).toBe(0);
  expect(preview.body.skippedExampleRows).toBe(3);
});

test('11.7 AC5 — non-.xlsx uploads are rejected with a clear error', async ({
  request,
  hotel,
}) => {
  const res = await apiPostForm(request, '/tenant/rooms/import/preview', {
    multipart: {
      file: { name: 'rooms.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') },
    },
  }, hotel.ownerToken);
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('IMPORT_FILE_INVALID');
});

test('11.7 AC5 — leading zeros survive; whitespace is trimmed; empty rows ignored', async ({
  request,
  hotel,
  standardType,
}) => {
  const preview = await apiPostForm(request, '/tenant/rooms/import/preview', {
    multipart: {
      file: await importFile([['  0090 ', '2', 'Standard', 'active'], null, null]),
    },
  }, hotel.ownerToken);
  expect(preview.status).toBe(200);
  expect(preview.body.invalidCount).toBe(0);
  expect(preview.body.validCount).toBe(1);
  expect((preview.body.rows as Array<{ roomNumber: string }>)[0].roomNumber).toBe('0090');

  const commit = await apiPost(request, '/tenant/rooms/bulk', {
    source: 'import',
    skipDuplicates: true,
    rooms: [
      { row: 2, roomNumber: '0090', floor: 2, roomTypeId: standardType.id, status: 'active' },
    ],
  }, hotel.ownerToken);
  expect(commit.status).toBe(201);
  const list = await listRooms(request, hotel.ownerToken, { search: '0090' });
  expect(list.body.data.map((r) => r.roomNumber)).toEqual(['0090']);
});

test('11.7 AC5 — uploads above 1000 data rows are capped', async ({
  request,
  hotel,
}) => {
  const rows: string[][] = [];
  for (let i = 0; i < 1001; i++) rows.push([`R${i}`, '2', 'Standard', 'active']);
  const preview = await apiPostForm(request, '/tenant/rooms/import/preview', {
    multipart: { file: await importFile(rows) },
  }, hotel.ownerToken);
  expect(preview.status).toBe(400);
  expect(preview.body.code).toBe('IMPORT_TOO_MANY_ROWS');
});

test('11.7 AC6 — audit: rooms.imported and rooms.exported are recorded', async ({
  request,
  hotel,
  standardType,
}) => {
  const { auditCount, lastAuditMeta } = await import('../../helpers/db');
  await apiGetRaw(request, '/tenant/rooms/export?search=82', hotel.ownerToken);
  await apiPost(request, '/tenant/rooms/bulk', {
    source: 'import',
    rooms: [{ row: 2, roomNumber: '850', roomTypeId: standardType.id }],
  }, hotel.ownerToken);

  expect(auditCount('rooms.exported', hotel.hotelId)).toBeGreaterThanOrEqual(1);
  const meta = lastAuditMeta('rooms.imported', hotel.hotelId);
  expect(meta, 'rooms.imported audit row exists').toBeTruthy();
  const parsed = JSON.parse(meta!);
  expect(parsed.count).toBe(1);
  expect(parsed.source).toBe('import');
});

// -------------------------------------------------------------------- utils

/** Reserve rooms with an explicit floor so the whole 8xx block stays unique. */
async function create8xx(
  request: Parameters<typeof apiPost>[0],
  token: string,
  typeId: string,
  rooms: Array<[string, number, 'active' | 'out_of_service']>,
) {
  for (const [roomNumber, floor, status] of rooms) {
    const res = await apiPost(request, '/tenant/rooms', {
      roomNumber,
      floor,
      roomTypeId: typeId,
      status,
    }, token);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
}
