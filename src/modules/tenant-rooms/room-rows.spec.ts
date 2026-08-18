import { BadRequestException } from '@nestjs/common';
import { expandRange, RoomRowInput, validateRoomRows } from './room-rows';

describe('expandRange (11.3)', () => {
  it('AC2 — 301..305 → ["301","302","303","304","305"]', () => {
    expect(expandRange({ from: 301, to: 305 })).toEqual([
      '301',
      '302',
      '303',
      '304',
      '305',
    ]);
  });

  it('AC2 — exclusions are skipped (301..305 minus 303)', () => {
    expect(expandRange({ from: 301, to: 305, exclusions: [303] })).toEqual([
      '301',
      '302',
      '304',
      '305',
    ]);
  });

  it('AC2 — from > to → 400', () => {
    expect(() => expandRange({ from: 10, to: 5 })).toThrow(BadRequestException);
    try {
      expandRange({ from: 10, to: 5 });
      fail('expected expandRange to throw');
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({
        code: expect.any(String),
      });
    }
  });

  it('range larger than 500 → 400 BULK_RANGE_TOO_LARGE', () => {
    expect(() => expandRange({ from: 1, to: 502 })).toThrow(BadRequestException);
    try {
      expandRange({ from: 1, to: 502 });
      fail('expected expandRange to throw');
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({
        code: 'BULK_RANGE_TOO_LARGE',
        max: 500,
      });
    }
  });

  it('a 500-room range is allowed (boundary, not > 500)', () => {
    expect(expandRange({ from: 1, to: 500 })).toHaveLength(500);
  });
});

describe('validateRoomRows (11.3/11.7)', () => {
  const row = (o: Partial<RoomRowInput> = {}): RoomRowInput => ({
    row: 1,
    roomNumber: '101',
    floor: null,
    roomTypeId: 'rt-1',
    status: 'active',
    ...o,
  });

  it('AC2 — flags rows whose normalized number already exists in the hotel (DUPLICATE_IN_HOTEL)', () => {
    const { rows } = validateRoomRows([row({ roomNumber: '101' })], {
      existingNumbers: new Set(['101']),
      typeIds: new Set(['rt-1']),
    });
    expect(rows[0].issues).toEqual([
      { row: 1, field: 'roomNumber', code: 'DUPLICATE_IN_HOTEL' },
    ]);
    expect(rows[0].normalizedNumber).toBe('101');
  });

  it('flags repeats inside the payload itself (DUPLICATE_IN_FILE — second occurrence only)', () => {
    const { rows } = validateRoomRows(
      [row({ row: 1, roomNumber: '101' }), row({ row: 2, roomNumber: '101' })],
      { existingNumbers: new Set(), typeIds: new Set(['rt-1']) },
    );
    expect(rows[0].issues).toEqual([]);
    expect(rows[1].issues).toEqual([
      { row: 2, field: 'roomNumber', code: 'DUPLICATE_IN_FILE' },
    ]);
  });

  it('empty roomNumber → REQUIRED; bad chars → INVALID_FORMAT; unknown type id → UNKNOWN_TYPE; bad status → INVALID_STATUS', () => {
    const ctx = { existingNumbers: new Set<string>(), typeIds: new Set(['rt-1']) };

    const required = validateRoomRows([row({ roomNumber: '  ' })], ctx);
    expect(required.rows[0].issues).toEqual([
      { row: 1, field: 'roomNumber', code: 'REQUIRED' },
    ]);

    const badFormat = validateRoomRows([row({ roomNumber: '101 #' })], ctx);
    expect(badFormat.rows[0].issues).toEqual([
      { row: 1, field: 'roomNumber', code: 'INVALID_FORMAT' },
    ]);

    const unknownType = validateRoomRows(
      [row({ roomNumber: '101', roomTypeId: 'rt-ghost' })],
      ctx,
    );
    expect(unknownType.rows[0].issues).toEqual([
      { row: 1, field: 'roomTypeId', code: 'UNKNOWN_TYPE' },
    ]);

    const badStatus = validateRoomRows(
      [row({ roomNumber: '101', status: 'bogus' as RoomRowInput['status'] })],
      ctx,
    );
    expect(badStatus.rows[0].issues).toEqual([
      { row: 1, field: 'status', code: 'INVALID_STATUS' },
    ]);
  });

  it('normalizes numbers ("007 " stays "007"; "101a" → "101A")', () => {
    const { rows } = validateRoomRows(
      [row({ row: 1, roomNumber: '007 ' }), row({ row: 2, roomNumber: '101a' })],
      { existingNumbers: new Set(), typeIds: new Set(['rt-1']) },
    );
    expect(rows[0].normalizedNumber).toBe('007');
    expect(rows[0].issues).toEqual([]);
    expect(rows[1].normalizedNumber).toBe('101A');
    expect(rows[1].issues).toEqual([]);
  });

  it('missing roomTypeId (null) → REQUIRED on roomTypeId', () => {
    const { rows } = validateRoomRows([row({ roomTypeId: null })], {
      existingNumbers: new Set(),
      typeIds: new Set(['rt-1']),
    });
    expect(rows[0].issues).toEqual([
      { row: 1, field: 'roomTypeId', code: 'REQUIRED' },
    ]);
  });

  it('a clean row has no issues and carries all original fields plus normalizedNumber', () => {
    const { rows } = validateRoomRows([row({ roomNumber: '101', floor: 2 })], {
      existingNumbers: new Set(),
      typeIds: new Set(['rt-1']),
    });
    expect(rows[0]).toEqual({
      row: 1,
      roomNumber: '101',
      floor: 2,
      roomTypeId: 'rt-1',
      status: 'active',
      normalizedNumber: '101',
      issues: [],
    });
  });
});
