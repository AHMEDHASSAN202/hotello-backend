import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { RoomRowInput } from '../room-rows';
import { RoomType } from '../room-type.entity';
import { EXAMPLE_PREFIX, MAX_IMPORT_ROWS, XLSX_STATUS_VALUES } from './rooms-xlsx.constants';

/**
 * Story 11.7 AC4/AC5 — parses an uploaded xlsx buffer into `RoomRowInput[]`
 * ready for `validateRoomRows` (the single validation source, `room-rows.ts`)
 * — this function never validates rows itself, only extracts them.
 *
 * A standalone pure function (no DB access, no injected state) rather than a
 * method on `RoomsXlsxService` — mirrors the `room-rows.ts` pattern
 * (`expandRange`/`validateRoomRows` are plain exported functions, not class
 * methods). This also keeps the module's DI graph one-directional:
 * `RoomsXlsxService.exportForHotel` already calls
 * `TenantRoomsService.listAllForExport`; if `TenantRoomsService.importPreview`
 * needed a `RoomsXlsxService.parseImport` *method*, the two services would
 * become mutually dependent (needing `forwardRef` on both constructors) for
 * no benefit, since this function touches none of `RoomsXlsxService`'s
 * injected repos/services. `TenantRoomsService.importPreview` imports and
 * calls this function directly instead.
 *
 * `types` (the hotel's ACTIVE room types, for name→id lookup) is supplied by
 * the caller so this stays directly unit-testable with real exceljs and no
 * mocks, exactly like `buildExport`/`buildTemplate`.
 *
 * `cell.text.trim()` (never `.value`) is used for every read so a room
 * number typed "007" survives as text instead of silently becoming the
 * number 7. Rows are skipped (not emitted) when every one of the 4 cells is
 * blank, or when Room Number starts with `EXAMPLE_PREFIX` ('#') — the
 * template's example rows — counted into `skippedExampleRows` instead. More
 * than `MAX_IMPORT_ROWS` real data rows throws before any DB call happens
 * (mirrors `expandRange`'s `BULK_RANGE_TOO_LARGE` discipline).
 */
export async function parseImport(
  buffer: Buffer,
  types: RoomType[],
): Promise<{ rows: RoomRowInput[]; skippedExampleRows: number }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new BadRequestException({
      code: 'IMPORT_FILE_INVALID',
      message: 'The uploaded file could not be read as an Excel workbook',
    });
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new BadRequestException({
      code: 'IMPORT_FILE_INVALID',
      message: 'The uploaded file has no worksheet',
    });
  }

  // Type NAME (case-insensitive, trimmed) → id, matched against both the
  // English and Arabic names of the hotel's active types — a hotel filling
  // its own-language dropdown or pasting the other language both resolve.
  const typeIdByName = new Map<string, string>();
  for (const type of types) {
    typeIdByName.set(type.nameEn.trim().toLowerCase(), type.id);
    typeIdByName.set(type.nameAr.trim().toLowerCase(), type.id);
  }

  const rows: RoomRowInput[] = [];
  let skippedExampleRows = 0;
  let dataRowCount = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const roomNumber = row.getCell(1).text.trim();
    const floorText = row.getCell(2).text.trim();
    const typeText = row.getCell(3).text.trim();
    const statusText = row.getCell(4).text.trim();

    if (!roomNumber && !floorText && !typeText && !statusText) return; // fully empty

    if (roomNumber.startsWith(EXAMPLE_PREFIX)) {
      skippedExampleRows += 1;
      return;
    }

    dataRowCount += 1;
    if (dataRowCount > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        code: 'IMPORT_TOO_MANY_ROWS',
        message: `An import cannot contain more than ${MAX_IMPORT_ROWS} rooms`,
        max: MAX_IMPORT_ROWS,
      });
    }

    // '' → optional/blank (null); a whole number parses; anything else is
    // NaN — the sentinel `validateRoomRows` flags as floor INVALID_FORMAT.
    const floor =
      floorText === ''
        ? null
        : /^-?\d+$/.test(floorText)
          ? parseInt(floorText, 10)
          : NaN;

    const statusMatch = XLSX_STATUS_VALUES.find(
      (value) => value.toLowerCase() === statusText.toLowerCase(),
    );

    rows.push({
      row: rowNumber,
      roomNumber,
      floor,
      roomTypeId: typeIdByName.get(typeText.toLowerCase()) ?? null,
      // Unmatched status text is passed through as-is so
      // `validateRoomRows` flags it INVALID_STATUS with the row/field
      // pointer, rather than this function silently discarding it.
      status: (statusMatch ?? statusText) as 'active' | 'out_of_service',
    });
  });

  return { rows, skippedExampleRows };
}
