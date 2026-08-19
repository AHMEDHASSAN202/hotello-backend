import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { Hotel } from '../../hotels/hotel.entity';
import { TenantUser } from '../../tenant-users/tenant-user.entity';
import { ListRoomsQueryDto } from '../dto/list-rooms-query.dto';
import { Room } from '../room.entity';
import { RoomType } from '../room-type.entity';
import { TenantRoomsService } from '../tenant-rooms.service';
import {
  EXAMPLE_PREFIX,
  XLSX_EXAMPLE_GREY_ARGB,
  XLSX_NAVY_ARGB,
  XLSX_STATUS_VALUES,
  XLSX_STRINGS,
  XlsxLanguageStrings,
  XLSX_WHITE_ARGB,
} from './rooms-xlsx.constants';

type XlsxLang = 'ar' | 'en';

/**
 * A single-range list data-validation cell (the runtime `dataValidations.add`
 * API — not exposed on exceljs's `Worksheet` type, hence the narrow local
 * type instead of `any`).
 */
interface WorksheetWithDataValidations extends ExcelJS.Worksheet {
  dataValidations: {
    add(address: string, validation: Partial<ExcelJS.DataValidation>): void;
  };
}

/** Excel's hard cap on a literal `"a,b,c"` data-validation list formula. */
const LITERAL_LIST_FORMULA_MAX_LENGTH = 255;

/** Story 11.3 AC2/AC3's template example rows carry plausible, non-real values. */
const TEMPLATE_EXAMPLE_ROOM_NUMBERS = [
  `${EXAMPLE_PREFIX}101`,
  `${EXAMPLE_PREFIX}102A`,
  `${EXAMPLE_PREFIX}201`,
];

/**
 * Story 11.7 AC1–AC3 — the rooms Excel export and its annotated per-hotel
 * import template. `buildExport`/`buildTemplate` are pure workbook builders
 * (real exceljs, no I/O) so they're directly unit-testable; `exportForHotel`/
 * `templateForHotel` are the thin orchestration the controller calls (load
 * hotel for language + data, build, audit) — the fat-service half of the
 * "thin controllers, fat services" rule.
 */
@Injectable()
export class RoomsXlsxService {
  constructor(
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(RoomType)
    private readonly roomTypesRepo: Repository<RoomType>,
    private readonly tenantRoomsService: TenantRoomsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * AC1/AC5 — one row per room: Room Number | Floor | Type | Status. Type
   * name resolves in the hotel's language; room-number cells are forced to
   * text (`numFmt: '@'` + a string value) so leading zeros ("007") and
   * alpha suffixes ("101A") survive the round trip.
   */
  async buildExport(rooms: Room[], lang: XlsxLang): Promise<Buffer> {
    const strings = XLSX_STRINGS[lang];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(strings.sheetName);

    this.writeHeaderRow(sheet, strings);

    for (const room of rooms) {
      const row = sheet.addRow([
        room.roomNumber,
        room.floor,
        lang === 'ar' ? room.roomType.nameAr : room.roomType.nameEn,
        room.status,
      ]);
      const numberCell = row.getCell(1);
      numberCell.value = room.roomNumber;
      numberCell.numFmt = '@';
    }

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = 'A1:D1';

    return workbook.xlsx.writeBuffer() as unknown as Buffer;
  }

  /**
   * AC2/AC3 — same headers as the export, plus a header comment per column
   * (required/optional + format rules, hotel-language), dropdowns for
   * Type (the hotel's actual active type names) and Status (the two literal
   * enum values), and 3 greyed example rows whose numbers start with `#`
   * (AC2's Room-Number note explains those are ignored on import).
   */
  async buildTemplate(types: RoomType[], lang: XlsxLang): Promise<Buffer> {
    const strings = XLSX_STRINGS[lang];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(strings.templateSheetName);

    this.writeHeaderRow(sheet, strings);
    this.writeHeaderNotes(sheet, strings);

    const typeNames = types.map((type) => (lang === 'ar' ? type.nameAr : type.nameEn));
    this.applyListValidation(workbook, sheet, 'C2:C1001', typeNames, '_RoomTypes');
    this.applyListValidation(
      workbook,
      sheet,
      'D2:D1001',
      [...XLSX_STATUS_VALUES],
      '_Statuses',
    );

    this.writeExampleRows(sheet, typeNames);

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = 'A1:D1';

    return workbook.xlsx.writeBuffer() as unknown as Buffer;
  }

  /**
   * `GET /tenant/rooms/export` orchestration — hotelId + language always
   * come from the authenticated actor's own hotel, filters from the same DTO
   * `list()` uses. Audits `rooms.exported` with the row count, after the
   * buffer is built (never inside a transaction — there isn't one here, but
   * keeps the "audit after the work, not before" discipline).
   */
  async exportForHotel(actor: TenantUser, query: ListRoomsQueryDto): Promise<Buffer> {
    const hotel = await this.loadHotel(actor.hotelId);
    const rooms = await this.tenantRoomsService.listAllForExport(actor.hotelId, query);
    const buffer = await this.buildExport(rooms, this.resolveLang(hotel));

    await this.auditLogs.log({
      action: 'rooms.exported',
      entityType: 'room',
      entityId: actor.hotelId,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        count: rooms.length,
      },
    });

    return buffer;
  }

  /**
   * `GET /tenant/rooms/import/template` orchestration — generated fresh on
   * every call (never cached, note 10): active room types can change between
   * two downloads, so the dropdown must always reflect the current catalog.
   * Not audited (only imported/exported rooms are — a template download
   * changes nothing).
   */
  async templateForHotel(hotelId: string): Promise<Buffer> {
    const hotel = await this.loadHotel(hotelId);
    const types = await this.roomTypesRepo.find({
      where: { hotelId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    return this.buildTemplate(types, this.resolveLang(hotel));
  }

  /** Navy fill, white bold text — the header row shared by export and template (brief step 4). */
  private writeHeaderRow(sheet: ExcelJS.Worksheet, strings: XlsxLanguageStrings): void {
    const row = sheet.addRow([
      strings.headers.number,
      strings.headers.floor,
      strings.headers.type,
      strings.headers.status,
    ]);
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_NAVY_ARGB } };
      cell.font = { color: { argb: XLSX_WHITE_ARGB }, bold: true };
    });
  }

  /** AC2 — one note per header cell; the Room Number note also explains the `#` example rows. */
  private writeHeaderNotes(sheet: ExcelJS.Worksheet, strings: XlsxLanguageStrings): void {
    const noteFor = (text: string): ExcelJS.Comment => ({ texts: [{ text }] });

    sheet.getCell('A1').note = noteFor(
      `${strings.notes.number} ${strings.exampleMarkerNote}`,
    );
    sheet.getCell('B1').note = noteFor(strings.notes.floor);
    sheet.getCell('C1').note = noteFor(strings.notes.type);
    sheet.getCell('D1').note = noteFor(strings.notes.status);
  }

  /**
   * AC3 — 3 grey italic example rows, numbers `#101`/`#102A`/`#201` (always
   * text via `numFmt: '@'`, same discipline as real room numbers).
   */
  private writeExampleRows(sheet: ExcelJS.Worksheet, typeNames: string[]): void {
    const exampleType = typeNames[0] ?? '';
    const secondExampleType = typeNames[1] ?? exampleType;
    const examples: Array<{
      floor: number;
      type: string;
      status: (typeof XLSX_STATUS_VALUES)[number];
    }> = [
      { floor: 1, type: exampleType, status: 'active' },
      { floor: 1, type: secondExampleType, status: 'active' },
      { floor: 2, type: exampleType, status: 'out_of_service' },
    ];

    TEMPLATE_EXAMPLE_ROOM_NUMBERS.forEach((roomNumber, i) => {
      const example = examples[i];
      const row = sheet.addRow([roomNumber, example.floor, example.type, example.status]);
      row.font = { italic: true, color: { argb: XLSX_EXAMPLE_GREY_ARGB } };
      const numberCell = row.getCell(1);
      numberCell.value = roomNumber;
      numberCell.numFmt = '@';
    });
  }

  /**
   * AC3 — list dropdown for `range`. Excel caps a literal `"a,b,c"` formula
   * at 255 chars; once the joined values exceed that, fall back to a hidden
   * sheet holding one value per row and a range-reference formula instead
   * (exceljs specifics note — both paths are exercised by the tests). A
   * value containing a comma (e.g. a room-type name like "Deluxe, Sea View")
   * must ALSO route through the hidden-sheet fallback: Excel's literal list
   * formula has no escape for an embedded comma, so joining with `,` would
   * silently split that one value into spurious extra dropdown entries.
   */
  private applyListValidation(
    workbook: ExcelJS.Workbook,
    sheet: ExcelJS.Worksheet,
    range: string,
    values: string[],
    hiddenSheetName: string,
  ): void {
    const dataValidations = (sheet as WorksheetWithDataValidations).dataValidations;
    const hasComma = values.some((value) => value.includes(','));
    const literalFormula = `"${values.join(',')}"`;

    if (!hasComma && literalFormula.length <= LITERAL_LIST_FORMULA_MAX_LENGTH) {
      dataValidations.add(range, {
        type: 'list',
        allowBlank: false,
        formulae: [literalFormula],
      });
      return;
    }

    const hiddenSheet = workbook.addWorksheet(hiddenSheetName);
    values.forEach((value, i) => {
      hiddenSheet.getCell(i + 1, 1).value = value;
    });
    // 'veryHidden' — not reachable via Excel's Unhide Sheet dialog either,
    // so a curious guest/staff user browsing sheet tabs never sees it.
    hiddenSheet.state = 'veryHidden';

    dataValidations.add(range, {
      type: 'list',
      allowBlank: false,
      formulae: [`'${hiddenSheetName}'!$A$1:$A$${values.length}`],
    });
  }

  /** Hotel default language ('ar' | 'en') decides header/notes language (brief note). */
  private resolveLang(hotel: Pick<Hotel, 'defaultLanguage'>): XlsxLang {
    return hotel.defaultLanguage === 'en' ? 'en' : 'ar';
  }

  private async loadHotel(hotelId: string): Promise<Hotel> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) {
      throw new NotFoundException({ code: 'HOTEL_NOT_FOUND', message: 'Hotel not found' });
    }
    return hotel;
  }
}
