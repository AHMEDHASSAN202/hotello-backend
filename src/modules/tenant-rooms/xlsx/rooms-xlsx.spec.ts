import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { Hotel } from '../../hotels/hotel.entity';
import { TenantUser } from '../../tenant-users/tenant-user.entity';
import { ListRoomsQueryDto } from '../dto/list-rooms-query.dto';
import { validateRoomRows } from '../room-rows';
import { Room } from '../room.entity';
import { RoomType } from '../room-type.entity';
import { TenantRoomsService } from '../tenant-rooms.service';
import { parseImport } from './parse-import';
import { EXAMPLE_PREFIX, XLSX_STRINGS } from './rooms-xlsx.constants';
import { RoomsXlsxService } from './rooms-xlsx.service';

const HOTEL_ID = 'hotel-1';

const makeRoomType = (o: Partial<RoomType> = {}): RoomType =>
  ({
    id: 'rt-1',
    hotelId: HOTEL_ID,
    nameEn: 'Standard',
    nameAr: 'قياسية',
    descriptionEn: null,
    descriptionAr: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as RoomType;

const makeRoom = (o: Record<string, unknown> = {}): Room =>
  ({
    id: 'room-1',
    hotelId: HOTEL_ID,
    roomNumber: '101',
    floor: 1,
    status: 'active',
    roomTypeId: 'rt-1',
    roomType: makeRoomType(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as unknown as Room;

/** Round-trips a buffer through exceljs the way a real consumer (Excel, a test) would read it back. */
async function reload(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

describe('buildExport (11.7)', () => {
  let service: RoomsXlsxService;
  let hotelsRepo: { findOne: jest.Mock };
  let roomTypesRepo: { find: jest.Mock };
  let tenantRoomsService: { listAllForExport: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn() };
    roomTypesRepo = { find: jest.fn() };
    tenantRoomsService = { listAllForExport: jest.fn() };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoomsXlsxService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(RoomType), useValue: roomTypesRepo },
        { provide: TenantRoomsService, useValue: tenantRoomsService },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(RoomsXlsxService);
  });

  it('AC1 — columns Room Number|Floor|Type|Status, one row per room, type name in hotel language', async () => {
    const rooms = [
      makeRoom({ roomNumber: '101', floor: 1, status: 'active' }),
      makeRoom({
        id: 'room-2',
        roomNumber: '102A',
        floor: 1,
        status: 'out_of_service',
        roomTypeId: 'rt-2',
        roomType: makeRoomType({ id: 'rt-2', nameEn: 'Deluxe', nameAr: 'ديلوكس' }),
      }),
    ];

    const bufferEn = await service.buildExport(rooms, 'en');
    const workbookEn = await reload(bufferEn);
    const sheetEn = workbookEn.getWorksheet(XLSX_STRINGS.en.sheetName)!;

    expect(sheetEn.getCell('A1').value).toBe('Room Number');
    expect(sheetEn.getCell('B1').value).toBe('Floor');
    expect(sheetEn.getCell('C1').value).toBe('Type');
    expect(sheetEn.getCell('D1').value).toBe('Status');

    expect(sheetEn.getCell('A2').value).toBe('101');
    expect(sheetEn.getCell('B2').value).toBe(1);
    expect(sheetEn.getCell('C2').value).toBe('Standard');
    expect(sheetEn.getCell('D2').value).toBe('active');

    expect(sheetEn.getCell('A3').value).toBe('102A');
    expect(sheetEn.getCell('C3').value).toBe('Deluxe');
    expect(sheetEn.getCell('D3').value).toBe('out_of_service');
    expect(sheetEn.actualRowCount).toBe(3); // header + 2 rooms, no more

    const bufferAr = await service.buildExport(rooms, 'ar');
    const workbookAr = await reload(bufferAr);
    const sheetAr = workbookAr.getWorksheet(XLSX_STRINGS.ar.sheetName)!;
    expect(sheetAr.getCell('C2').value).toBe('قياسية');
    expect(sheetAr.getCell('C3').value).toBe('ديلوكس');
  });

  it('AC1 — header row: navy fill #0E2A47, white bold text, frozen (ySplit 1), autoFilter A1:D1', async () => {
    const buffer = await service.buildExport([makeRoom()], 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.sheetName)!;

    const headerCell = sheet.getCell('A1');
    expect(headerCell.fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0E2A47' },
    });
    expect(headerCell.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } });

    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBe('A1:D1');
  });

  it('AC5 — room numbers are written as text ("007" survives round-trip)', async () => {
    const rooms = [makeRoom({ roomNumber: '007' })];
    const buffer = await service.buildExport(rooms, 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.sheetName)!;

    const cell = sheet.getCell('A2');
    expect(cell.value).toBe('007');
    expect(typeof cell.value).toBe('string');
    expect(cell.numFmt).toBe('@');
  });

  describe('exportForHotel orchestration', () => {
    it('resolves hotelId/language from the actor, calls listAllForExport with the same filters, and audits rooms.exported with { hotelId, count }', async () => {
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, defaultLanguage: 'en' });
      const rooms = [makeRoom(), makeRoom({ id: 'room-2', roomNumber: '102' })];
      tenantRoomsService.listAllForExport.mockResolvedValue(rooms);

      const actor = { id: 'actor-1', hotelId: HOTEL_ID } as unknown as TenantUser;
      const query = { floor: 2 } as ListRoomsQueryDto;

      const buffer = await service.exportForHotel(actor, query);

      expect(tenantRoomsService.listAllForExport).toHaveBeenCalledWith(HOTEL_ID, query);
      expect(auditLogs.log).toHaveBeenCalledWith({
        action: 'rooms.exported',
        entityType: 'room',
        entityId: HOTEL_ID,
        actorId: 'actor-1',
        metadata: { actorType: 'tenant_user', hotelId: HOTEL_ID, count: 2 },
      });
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('unknown hotel → 404 HOTEL_NOT_FOUND, never calls listAllForExport', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      const actor = { id: 'actor-1', hotelId: HOTEL_ID } as unknown as TenantUser;

      await expect(
        service.exportForHotel(actor, {} as ListRoomsQueryDto),
      ).rejects.toMatchObject({ response: { code: 'HOTEL_NOT_FOUND' } });
      expect(tenantRoomsService.listAllForExport).not.toHaveBeenCalled();
    });
  });
});

describe('buildTemplate (11.7)', () => {
  let service: RoomsXlsxService;
  let hotelsRepo: { findOne: jest.Mock };
  let roomTypesRepo: { find: jest.Mock };
  let tenantRoomsService: { listAllForExport: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn() };
    roomTypesRepo = { find: jest.fn() };
    tenantRoomsService = { listAllForExport: jest.fn() };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoomsXlsxService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(RoomType), useValue: roomTypesRepo },
        { provide: TenantRoomsService, useValue: tenantRoomsService },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(RoomsXlsxService);
  });

  const types = [
    makeRoomType({ id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' }),
    makeRoomType({ id: 'rt-2', nameEn: 'Deluxe', nameAr: 'ديلوكس' }),
    makeRoomType({ id: 'rt-3', nameEn: 'Suite', nameAr: 'جناح' }),
  ];

  it('AC2 — every header cell carries a note in the hotel default_language stating required/optional + rules', async () => {
    const buffer = await service.buildTemplate(types, 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;

    const numberNote = sheet.getCell('A1').note as unknown as string | { texts: { text: string }[] };
    const noteText = (n: typeof numberNote) =>
      typeof n === 'string' ? n : n.texts.map((t) => t.text).join('');

    expect(noteText(numberNote)).toContain('Required');
    expect(noteText(numberNote)).toContain('Unique per hotel');
    expect(noteText(sheet.getCell('B1').note as never)).toContain('Optional');
    expect(noteText(sheet.getCell('C1').note as never)).toContain('Required');
    expect(noteText(sheet.getCell('C1').note as never)).toContain('dropdown');
    expect(noteText(sheet.getCell('D1').note as never)).toContain('active or out_of_service');
  });

  it('AC2 — notes are Arabic for ar hotels and English for en hotels', async () => {
    const bufferEn = await service.buildTemplate(types, 'en');
    const workbookEn = await reload(bufferEn);
    const sheetEn = workbookEn.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;
    const enNote = sheetEn.getCell('A1').note;
    const enText = typeof enNote === 'string' ? enNote : (enNote as any).texts.map((t: any) => t.text).join('');
    expect(enText).toBe(`${XLSX_STRINGS.en.notes.number} ${XLSX_STRINGS.en.exampleMarkerNote}`);

    const bufferAr = await service.buildTemplate(types, 'ar');
    const workbookAr = await reload(bufferAr);
    const sheetAr = workbookAr.getWorksheet(XLSX_STRINGS.ar.templateSheetName)!;
    const arNote = sheetAr.getCell('A1').note;
    const arText = typeof arNote === 'string' ? arNote : (arNote as any).texts.map((t: any) => t.text).join('');
    expect(arText).toBe(`${XLSX_STRINGS.ar.notes.number} ${XLSX_STRINGS.ar.exampleMarkerNote}`);
    expect(arText).toMatch(/[؀-ۿ]/); // contains Arabic script
  });

  it('AC3 — Type column has a list data-validation with the hotel\'s ACTUAL active type names', async () => {
    const buffer = await service.buildTemplate(types, 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;

    const validation = sheet.getCell('C2').dataValidation;
    expect(validation?.type).toBe('list');
    expect(validation?.formulae?.[0]).toBe('"Standard,Deluxe,Suite"');
  });

  it("AC3 — Status column dropdown is exactly \"active,out_of_service\"", async () => {
    const buffer = await service.buildTemplate(types, 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;

    const validation = sheet.getCell('D2').dataValidation;
    expect(validation?.type).toBe('list');
    expect(validation?.formulae?.[0]).toBe('"active,out_of_service"');
  });

  it('AC3 — contains 2-3 greyed example rows whose numbers start with "#"', async () => {
    const buffer = await service.buildTemplate(types, 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;

    const exampleNumbers = [
      sheet.getCell('A2').value,
      sheet.getCell('A3').value,
      sheet.getCell('A4').value,
    ];
    expect(exampleNumbers).toEqual(['#101', '#102A', '#201']);
    exampleNumbers.forEach((n) => expect(String(n).startsWith(EXAMPLE_PREFIX)).toBe(true));

    const row2Font = sheet.getCell('A2').font;
    expect(row2Font).toMatchObject({ italic: true, color: { argb: 'FF9AA0A6' } });

    // Only 3 example rows — row 5 is empty (no 4th example).
    expect(sheet.getCell('A5').value).toBeNull();
  });

  it('falls back to a hidden sheet + range-reference formula when the joined type names exceed Excel\'s 255-char literal-list cap', async () => {
    const manyTypes = Array.from({ length: 20 }, (_, i) =>
      makeRoomType({
        id: `rt-${i}`,
        nameEn: `Very Long Room Type Name Number ${i + 1} Wing`,
        nameAr: `اسم نوع غرفة طويل جدًا رقم ${i + 1}`,
      }),
    );
    const joinedLength = manyTypes.map((t) => t.nameEn).join(',').length;
    expect(joinedLength).toBeGreaterThan(255); // sanity check the fixture actually exceeds the cap

    const buffer = await service.buildTemplate(manyTypes, 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;

    const validation = sheet.getCell('C2').dataValidation;
    expect(validation?.type).toBe('list');
    expect(validation?.formulae?.[0]).toMatch(/^'?_RoomTypes'?!\$A\$1:\$A\$20$/);

    const hiddenSheet = workbook.getWorksheet('_RoomTypes');
    expect(hiddenSheet).toBeDefined();
    expect(hiddenSheet!.state).toBe('veryHidden');
    expect(hiddenSheet!.getCell('A1').value).toBe(manyTypes[0].nameEn);
    expect(hiddenSheet!.getCell('A20').value).toBe(manyTypes[19].nameEn);
  });

  it('short type-name list stays on the literal formula (no hidden sheet created)', async () => {
    const buffer = await service.buildTemplate(types, 'en');
    const workbook = await reload(buffer);
    expect(workbook.getWorksheet('_RoomTypes')).toBeUndefined();
  });

  it('a type name containing a comma routes through the hidden-sheet fallback (a literal join would split it into spurious dropdown entries)', async () => {
    const commaTypes = [
      makeRoomType({ id: 'rt-1', nameEn: 'Deluxe, Sea View', nameAr: 'ديلوكس، إطلالة بحرية' }),
      makeRoomType({ id: 'rt-2', nameEn: 'Standard', nameAr: 'قياسية' }),
    ];
    const joinedLength = commaTypes.map((t) => t.nameEn).join(',').length;
    expect(joinedLength).toBeLessThanOrEqual(255); // sanity check: comma alone triggers the fallback, not length

    const buffer = await service.buildTemplate(commaTypes, 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;

    const validation = sheet.getCell('C2').dataValidation;
    expect(validation?.type).toBe('list');
    expect(validation?.formulae?.[0]).toMatch(/^'?_RoomTypes'?!\$A\$1:\$A\$2$/);

    const hiddenSheet = workbook.getWorksheet('_RoomTypes');
    expect(hiddenSheet).toBeDefined();
    expect(hiddenSheet!.state).toBe('veryHidden');
    // Values survive intact — NOT split on the embedded comma.
    expect(hiddenSheet!.getCell('A1').value).toBe('Deluxe, Sea View');
    expect(hiddenSheet!.getCell('A2').value).toBe('Standard');
  });

  it('header row is styled the same navy/white/frozen/autofilter as the export', async () => {
    const buffer = await service.buildTemplate(types, 'en');
    const workbook = await reload(buffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;

    expect(sheet.getCell('A1').fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0E2A47' },
    });
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  describe('templateForHotel orchestration', () => {
    it('loads only ACTIVE types for the hotel, resolves language from hotel.defaultLanguage, and never audits', async () => {
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, defaultLanguage: 'ar' });
      roomTypesRepo.find.mockResolvedValue(types);

      const buffer = await service.templateForHotel(HOTEL_ID);

      expect(roomTypesRepo.find).toHaveBeenCalledWith({
        where: { hotelId: HOTEL_ID, isActive: true },
        order: { createdAt: 'ASC' },
      });
      expect(auditLogs.log).not.toHaveBeenCalled();

      const workbook = await reload(buffer);
      expect(workbook.getWorksheet(XLSX_STRINGS.ar.templateSheetName)).toBeDefined();
    });

    it('unknown hotel → 404 HOTEL_NOT_FOUND', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(service.templateForHotel(HOTEL_ID)).rejects.toMatchObject({
        response: { code: 'HOTEL_NOT_FOUND' },
      });
    });
  });
});

describe('parseImport (11.7)', () => {
  // Story 11.7 fix round — `parseImport` moved out of RoomsXlsxService into a
  // standalone pure function (xlsx/parse-import.ts) to avoid a circular
  // dependency (TenantRoomsService.importPreview needed it, and
  // RoomsXlsxService.exportForHotel already depends on TenantRoomsService).
  // `service` here is only ever used for `buildTemplate`/`buildExport` — the
  // fixtures for the round-trip tests — `parseImport` itself is called as a
  // plain imported function, real exceljs, no mocking.
  let service: RoomsXlsxService;
  let hotelsRepo: { findOne: jest.Mock };
  let roomTypesRepo: { find: jest.Mock };
  let tenantRoomsService: { listAllForExport: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn() };
    roomTypesRepo = { find: jest.fn() };
    tenantRoomsService = { listAllForExport: jest.fn() };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoomsXlsxService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(RoomType), useValue: roomTypesRepo },
        { provide: TenantRoomsService, useValue: tenantRoomsService },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(RoomsXlsxService);
  });

  const types = [
    makeRoomType({ id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' }),
    makeRoomType({ id: 'rt-2', nameEn: 'Deluxe', nameAr: 'ديلوكس' }),
    makeRoomType({ id: 'rt-3', nameEn: 'Suite', nameAr: 'جناح' }),
  ];

  /** A minimal 4-column workbook built by hand (independent of buildTemplate/buildExport). */
  const workbookWithRows = async (rows: unknown[][]): Promise<Buffer> => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Rooms');
    sheet.addRow(['Room Number', 'Floor', 'Type', 'Status']);
    for (const r of rows) {
      const row = sheet.addRow(r);
      if (typeof r[0] === 'string') {
        row.getCell(1).value = r[0];
        row.getCell(1).numFmt = '@';
      }
    }
    return workbook.xlsx.writeBuffer() as unknown as Buffer;
  };

  it('AC5 — round-trip: buildTemplate → fill rows → parseImport yields exactly those rows (zero diffs)', async () => {
    const templateBuffer = await service.buildTemplate(types, 'en');
    const workbook = await reload(templateBuffer);
    const sheet = workbook.getWorksheet(XLSX_STRINGS.en.templateSheetName)!;

    // The template already has 3 greyed `#`-prefixed example rows (2-4);
    // append two real data rows after them.
    const row5 = sheet.addRow(['301', 1, 'Standard', 'active']);
    row5.getCell(1).value = '301';
    row5.getCell(1).numFmt = '@';
    const row6 = sheet.addRow(['302', 2, 'Deluxe', 'out_of_service']);
    row6.getCell(1).value = '302';
    row6.getCell(1).numFmt = '@';

    const filledBuffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const { rows, skippedExampleRows } = await parseImport(filledBuffer, types);

    expect(skippedExampleRows).toBe(3);
    expect(rows).toEqual([
      { row: 5, roomNumber: '301', floor: 1, roomTypeId: 'rt-1', status: 'active' },
      { row: 6, roomNumber: '302', floor: 2, roomTypeId: 'rt-2', status: 'out_of_service' },
    ]);
  });

  it('AC5 — example rows (# prefix) and trailing empty rows are ignored; whitespace trimmed', async () => {
    const buffer = await workbookWithRows([
      ['#101', 1, 'Standard', 'active'],
      [' 301 ', ' 2 ', ' Standard ', ' active '],
      [],
      [null, null, null, null],
    ]);

    const { rows, skippedExampleRows } = await parseImport(buffer, types);

    expect(skippedExampleRows).toBe(1);
    expect(rows).toEqual([
      { row: 3, roomNumber: '301', floor: 2, roomTypeId: 'rt-1', status: 'active' },
    ]);
  });

  it('AC5 — leading-zero numbers survive as text ("007")', async () => {
    const buffer = await workbookWithRows([['007', 1, 'Standard', 'active']]);

    const { rows } = await parseImport(buffer, types);

    expect(rows[0].roomNumber).toBe('007');
  });

  it('AC5 — more than 1,000 data rows → 400 IMPORT_TOO_MANY_ROWS', async () => {
    const extra = Array.from({ length: 1001 }, (_, i) => [
      `R${i}`,
      1,
      'Standard',
      'active',
    ]);
    const buffer = await workbookWithRows(extra);

    await expect(parseImport(buffer, types)).rejects.toMatchObject({
      response: { code: 'IMPORT_TOO_MANY_ROWS', max: 1000 },
    });
  });

  it('type name matches nameAr too, case-insensitive; unknown name → roomTypeId null', async () => {
    const buffer = await workbookWithRows([
      ['301', 1, 'ديلوكس', 'active'], // exact Arabic name → rt-2
      ['302', 1, 'STANDARD', 'active'], // case-insensitive English → rt-1
      ['303', 1, 'Nonexistent Type', 'active'], // unknown → null
    ]);

    const { rows } = await parseImport(buffer, types);

    expect(rows[0].roomTypeId).toBe('rt-2');
    expect(rows[1].roomTypeId).toBe('rt-1');
    expect(rows[2].roomTypeId).toBeNull();
  });

  it('non-numeric floor text → floor NaN (validateRoomRows later flags INVALID_FORMAT); blank floor → null', async () => {
    const buffer = await workbookWithRows([
      ['301', 'ground', 'Standard', 'active'],
      ['302', '', 'Standard', 'active'],
    ]);

    const { rows } = await parseImport(buffer, types);

    expect(Number.isNaN(rows[0].floor)).toBe(true);
    expect(rows[1].floor).toBeNull();
  });

  it('status matched case-insensitively; unmatched status text is passed through for validateRoomRows to flag INVALID_STATUS', async () => {
    const buffer = await workbookWithRows([
      ['301', 1, 'Standard', 'ACTIVE'],
      ['302', 1, 'Standard', 'Out_Of_Service'],
      ['303', 1, 'Standard', 'retired'],
    ]);

    const { rows } = await parseImport(buffer, types);

    expect(rows[0].status).toBe('active');
    expect(rows[1].status).toBe('out_of_service');
    expect(rows[2].status).toBe('retired');
  });

  it('a corrupt / non-xlsx buffer that fails to load → 400 IMPORT_FILE_INVALID', async () => {
    const buffer = Buffer.from('not a real xlsx file');

    await expect(parseImport(buffer, types)).rejects.toMatchObject({
      response: { code: 'IMPORT_FILE_INVALID' },
    });
  });

  it('a workbook with zero worksheets (loads fine, no sheet to read) → 400 IMPORT_FILE_INVALID', async () => {
    const emptyWorkbook = new ExcelJS.Workbook(); // never call addWorksheet
    const buffer = (await emptyWorkbook.xlsx.writeBuffer()) as unknown as Buffer;

    await expect(parseImport(buffer, types)).rejects.toMatchObject({
      response: { code: 'IMPORT_FILE_INVALID' },
    });
  });
});

describe('export → import round-trip (11.7 AC4/AC5)', () => {
  let service: RoomsXlsxService;
  let hotelsRepo: { findOne: jest.Mock };
  let roomTypesRepo: { find: jest.Mock };
  let tenantRoomsService: { listAllForExport: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn() };
    roomTypesRepo = { find: jest.fn() };
    tenantRoomsService = { listAllForExport: jest.fn() };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoomsXlsxService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(RoomType), useValue: roomTypesRepo },
        { provide: TenantRoomsService, useValue: tenantRoomsService },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(RoomsXlsxService);
  });

  it("AC4/AC5 — buildExport()'s own output, re-imported via parseImport(), round-trips with zero diffs and every row flags DUPLICATE_IN_HOTEL against the same fixtures", async () => {
    const typeStandard = makeRoomType({ id: 'rt-1', nameEn: 'Standard', nameAr: 'قياسية' });
    const typeDeluxe = makeRoomType({ id: 'rt-2', nameEn: 'Deluxe', nameAr: 'ديلوكس' });
    const types = [typeStandard, typeDeluxe];

    const rooms = [
      makeRoom({
        id: 'room-1',
        roomNumber: '101',
        floor: 1,
        status: 'active',
        roomTypeId: 'rt-1',
        roomType: typeStandard,
      }),
      makeRoom({
        id: 'room-2',
        roomNumber: '102A',
        floor: 1,
        status: 'out_of_service',
        roomTypeId: 'rt-2',
        roomType: typeDeluxe,
      }),
      makeRoom({
        id: 'room-3',
        roomNumber: '007',
        floor: null,
        status: 'active',
        roomTypeId: 'rt-1',
        roomType: typeStandard,
      }),
    ];

    // Real buildExport() output, real parseImport() re-parse — no mocking
    // anywhere in this chain.
    const exportBuffer = await service.buildExport(rooms, 'en');
    const { rows, skippedExampleRows } = await parseImport(exportBuffer, types);

    // Zero diffs: every exported room comes back with the exact same
    // roomNumber/floor/roomTypeId/status it was exported with.
    expect(skippedExampleRows).toBe(0);
    expect(rows).toEqual([
      { row: 2, roomNumber: '101', floor: 1, roomTypeId: 'rt-1', status: 'active' },
      { row: 3, roomNumber: '102A', floor: 1, roomTypeId: 'rt-2', status: 'out_of_service' },
      { row: 4, roomNumber: '007', floor: null, roomTypeId: 'rt-1', status: 'active' },
    ]);

    // Re-importing a hotel's own export (nothing changed) must flag every
    // row as an existing-in-hotel duplicate, never anything else.
    const existingNumbers = new Set(rooms.map((r) => r.roomNumber));
    const typeIds = new Set(types.map((t) => t.id));
    const { rows: validated } = validateRoomRows(rows, { existingNumbers, typeIds });

    expect(validated).toHaveLength(3);
    for (const row of validated) {
      expect(row.issues).toEqual([
        { row: row.row, field: 'roomNumber', code: 'DUPLICATE_IN_HOTEL' },
      ]);
    }
  });
});
