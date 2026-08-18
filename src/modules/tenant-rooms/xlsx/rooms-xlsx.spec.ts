import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { Hotel } from '../../hotels/hotel.entity';
import { TenantUser } from '../../tenant-users/tenant-user.entity';
import { ListRoomsQueryDto } from '../dto/list-rooms-query.dto';
import { Room } from '../room.entity';
import { RoomType } from '../room-type.entity';
import { TenantRoomsService } from '../tenant-rooms.service';
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
