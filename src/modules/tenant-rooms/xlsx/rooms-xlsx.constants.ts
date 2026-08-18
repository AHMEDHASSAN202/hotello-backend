/**
 * Story 11.7 — typed strings for the rooms Excel export + annotated import
 * template. Backend print/xlsx strings are typed TS constants (the
 * email-template convention), never i18n files — see `pdf/print.constants.ts`
 * for the same pattern applied to the QR poster/cards PDFs.
 */

/** Brand navy header fill / white header text — ARGB (exceljs fill/font format). */
export const XLSX_NAVY_ARGB = 'FF0E2A47';
export const XLSX_WHITE_ARGB = 'FFFFFFFF';
/** Grey used for the template's greyed-out example rows. */
export const XLSX_EXAMPLE_GREY_ARGB = 'FF9AA0A6';

/**
 * AC3 — the Status column dropdown is always exactly these two literal enum
 * values, in every language (they are parsed on import, never translated).
 */
export const XLSX_STATUS_VALUES = ['active', 'out_of_service'] as const;

/** Room numbers starting with this prefix are template examples, ignored on import. */
export const EXAMPLE_PREFIX = '#';

/**
 * Story 11.7 AC5 — import upload constraints. Mirrors the
 * `LOGO_MAX_BYTES`/`LOGO_MIME_TYPES` pattern in `hotels.constants.ts`: a size
 * cap enforced by `FileInterceptor`, and the accepted mime types for the
 * `.xlsx` extension check (`application/octet-stream` is included because
 * some OS/browser combinations mislabel `.xlsx` uploads with the generic
 * binary type instead of the OOXML spreadsheet type).
 */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_XLSX_MIME_TYPES: string[] = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];

/** Story 11.7 AC5 — hard cap on parsed data rows (`IMPORT_TOO_MANY_ROWS`). */
export const MAX_IMPORT_ROWS = 1000;

/** Header note (AC2/AC3) — labels + explanation text for one column. */
export interface XlsxColumnStrings {
  number: string;
  floor: string;
  type: string;
  status: string;
}

export interface XlsxLanguageStrings {
  sheetName: string;
  templateSheetName: string;
  headers: XlsxColumnStrings;
  notes: XlsxColumnStrings;
  /** Appended to the Room Number header note — explains the `#`-prefixed example rows. */
  exampleMarkerNote: string;
}

/**
 * AC1/AC2 — export headers + template header notes, in the hotel's
 * `default_language` ('ar' | 'en'). Every user-visible string ships both
 * languages in this same constant (global i18n rule).
 */
export const XLSX_STRINGS: Record<'ar' | 'en', XlsxLanguageStrings> = {
  en: {
    sheetName: 'Rooms',
    templateSheetName: 'Rooms',
    headers: {
      number: 'Room Number',
      floor: 'Floor',
      type: 'Type',
      status: 'Status',
    },
    notes: {
      number:
        'Required. Unique per hotel. Letters/numbers allowed (e.g., 101, 101A).',
      floor: 'Optional. Whole number (e.g., 1, 2, 12). Leave blank if not applicable.',
      type: 'Required. Pick a value from the dropdown. Manage room types under Rooms → Types.',
      status: 'Required. Pick a value from the dropdown: active or out_of_service.',
    },
    exampleMarkerNote:
      'Rows whose Room Number starts with "#" are examples only and are ignored on import — delete or overwrite them.',
  },
  ar: {
    sheetName: 'الغرف',
    templateSheetName: 'الغرف',
    headers: {
      number: 'رقم الغرفة',
      floor: 'الطابق',
      type: 'النوع',
      status: 'الحالة',
    },
    notes: {
      number: 'مطلوب. فريد لكل فندق. يُسمح بالأحرف والأرقام (مثال: 101، 101A).',
      floor: 'اختياري. رقم صحيح (مثال: 1، 2، 12). اتركه فارغًا إن لم ينطبق.',
      type: 'مطلوب. اختر قيمة من القائمة المنسدلة. يمكن إدارة أنواع الغرف من الغرف ← الأنواع.',
      status: 'مطلوب. اختر قيمة من القائمة المنسدلة: active أو out_of_service.',
    },
    exampleMarkerNote:
      'الصفوف التي يبدأ رقم الغرفة فيها بـ "#" هي أمثلة فقط ويتم تجاهلها عند الاستيراد — احذفها أو استبدلها.',
  },
};
