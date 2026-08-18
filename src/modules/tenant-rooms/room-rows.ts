import { BadRequestException } from '@nestjs/common';

/**
 * Story 11.3 AC2 — pure helpers with no DB access. This is the SINGLE
 * validation source for both range-based bulk creation (this task) and the
 * Excel import (Story 11.7, Task 11) — DB-derived context (`existingNumbers`,
 * `typeIds`) is always passed in by the caller so these stay unit-testable
 * without mocks.
 */

/** Global cap on a single range expansion (`BULK_RANGE_TOO_LARGE`). */
export const MAX_BULK_RANGE = 500;

/** Room-number format, mirrored from `CreateRoomDto` (global constraint). */
export const ROOM_NUMBER_REGEX = /^[A-Za-z0-9-]{1,20}$/;

export interface ExpandRangeInput {
  from: number;
  to: number;
  exclusions?: number[];
}

/**
 * Expands a numeric range (inclusive) into normalized room-number strings,
 * skipping any excluded numbers. Throws 400 on an inverted range and 400
 * `BULK_RANGE_TOO_LARGE` past `MAX_BULK_RANGE` rooms — both checked before
 * any DB access happens upstream.
 */
export function expandRange({ from, to, exclusions = [] }: ExpandRangeInput): string[] {
  if (from > to) {
    throw new BadRequestException({
      code: 'BULK_RANGE_INVALID',
      message: '"from" must be less than or equal to "to"',
    });
  }
  if (to - from + 1 > MAX_BULK_RANGE) {
    throw new BadRequestException({
      code: 'BULK_RANGE_TOO_LARGE',
      message: `A bulk range cannot exceed ${MAX_BULK_RANGE} rooms`,
      max: MAX_BULK_RANGE,
    });
  }

  const excluded = new Set(exclusions);
  const numbers: string[] = [];
  for (let n = from; n <= to; n++) {
    if (excluded.has(n)) continue;
    numbers.push(String(n));
  }
  return numbers;
}

/** One row to validate — shared shape for a range-expanded row or an Excel row. */
export interface RoomRowInput {
  row: number;
  roomNumber: string;
  floor: number | null;
  roomTypeId: string | null;
  status: 'active' | 'out_of_service';
}

export type RowIssueField = 'roomNumber' | 'floor' | 'roomTypeId' | 'status';
export type RowIssueCode =
  | 'REQUIRED'
  | 'INVALID_FORMAT'
  | 'DUPLICATE_IN_HOTEL'
  | 'DUPLICATE_IN_FILE'
  | 'UNKNOWN_TYPE'
  | 'INVALID_STATUS';

export interface RowIssue {
  row: number;
  field: RowIssueField;
  code: RowIssueCode;
}

export type ValidatedRow = RoomRowInput & {
  normalizedNumber: string;
  issues: RowIssue[];
};

export interface ValidateRoomRowsContext {
  /** Already-normalized (`trim().toUpperCase()`) room numbers taken in the hotel. */
  existingNumbers: Set<string>;
  /** Ids of room types usable in the hotel (active types only). */
  typeIds: Set<string>;
}

/**
 * Validates a batch of rows against shared, hotel-scoped context. Pure — no
 * DB access. `DUPLICATE_IN_FILE` is only raised on the second (and later)
 * occurrence of a normalized number within the same payload; the first
 * occurrence stays clean (unless it also collides with `existingNumbers`).
 */
export function validateRoomRows(
  rows: RoomRowInput[],
  ctx: ValidateRoomRowsContext,
): { rows: ValidatedRow[] } {
  const seenInFile = new Set<string>();

  const validated = rows.map((row): ValidatedRow => {
    const issues: RowIssue[] = [];
    const normalizedNumber = (row.roomNumber ?? '').trim().toUpperCase();

    if (!normalizedNumber) {
      issues.push({ row: row.row, field: 'roomNumber', code: 'REQUIRED' });
    } else if (!ROOM_NUMBER_REGEX.test(normalizedNumber)) {
      issues.push({ row: row.row, field: 'roomNumber', code: 'INVALID_FORMAT' });
    } else if (ctx.existingNumbers.has(normalizedNumber)) {
      issues.push({ row: row.row, field: 'roomNumber', code: 'DUPLICATE_IN_HOTEL' });
    } else if (seenInFile.has(normalizedNumber)) {
      issues.push({ row: row.row, field: 'roomNumber', code: 'DUPLICATE_IN_FILE' });
    }

    if (normalizedNumber && ROOM_NUMBER_REGEX.test(normalizedNumber)) {
      seenInFile.add(normalizedNumber);
    }

    if (!row.roomTypeId) {
      issues.push({ row: row.row, field: 'roomTypeId', code: 'REQUIRED' });
    } else if (!ctx.typeIds.has(row.roomTypeId)) {
      issues.push({ row: row.row, field: 'roomTypeId', code: 'UNKNOWN_TYPE' });
    }

    if (row.status !== 'active' && row.status !== 'out_of_service') {
      issues.push({ row: row.row, field: 'status', code: 'INVALID_STATUS' });
    }

    return { ...row, normalizedNumber, issues };
  });

  return { rows: validated };
}
