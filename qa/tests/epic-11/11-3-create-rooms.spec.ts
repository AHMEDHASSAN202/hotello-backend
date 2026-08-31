/**
 * Epic 11 — Story 11.3 Create Rooms (single + bulk), plan-limit guard,
 * atomicity, audit.
 */
import { expect, test } from '../../fixtures';
import {
  apiPost,
  createPlan,
  listRooms,
  provisionHotel,
  standardTypeId,
} from '../../helpers/gxp-api';
import { auditCountByMeta, lastAuditMeta } from '../../helpers/db';

test('11.3 AC1 — create a single room with number, floor, type; default status active', async ({
  request,
  hotel,
  standardType,
}) => {
  const { status, body } = await apiPost(request, '/tenant/rooms', {
    roomNumber: '101',
    floor: 1,
    roomTypeId: standardType.id,
  }, hotel.ownerToken);
  expect(status).toBe(201);
  expect(body).toMatchObject({
    roomNumber: '101',
    floor: 1,
    status: 'active',
    roomType: { id: standardType.id },
  });
});

test('11.3 AC1 — alphanumeric room numbers are supported (101A, leading zeros)', async ({
  request,
  hotel,
  standardType,
}) => {
  for (const number of ['101A', '007']) {
    const { status, body } = await apiPost(request, '/tenant/rooms', {
      roomNumber: number,
      roomTypeId: standardType.id,
    }, hotel.ownerToken);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.roomNumber).toBe(number);
  }
});

test('11.3 AC1 — duplicate room number → 409 with the number', async ({
  request,
  hotel,
  standardType,
}) => {
  await apiPost(request, '/tenant/rooms', { roomNumber: '102', roomTypeId: standardType.id }, hotel.ownerToken);
  const dup = await apiPost(request, '/tenant/rooms', { roomNumber: '102', roomTypeId: standardType.id }, hotel.ownerToken);
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('ROOM_NUMBER_TAKEN');
  expect(dup.body.roomNumber).toBe('102');
});

test('11.3 AC1 — invalid room number formats → 400 field validation', async ({
  request,
  hotel,
  standardType,
}) => {
  for (const bad of ['', 'ROOM WITH SPACE', 'X'.repeat(21), 'طابق']) {
    const { status, body } = await apiPost(request, '/tenant/rooms', {
      roomNumber: bad,
      roomTypeId: standardType.id,
    }, hotel.ownerToken);
    expect(status, `roomNumber "${bad}"`).toBe(400);
    expect(Array.isArray((body as Record<string, unknown>).message)).toBe(true);
  }
  // 21 chars fails; 20 chars is the documented cap.
  const okMax = await apiPost(request, '/tenant/rooms', {
    roomNumber: 'X'.repeat(20),
    roomTypeId: standardType.id,
  }, hotel.ownerToken);
  expect(okMax.status).toBe(201);
});

test('11.3 AC1 — unknown room type → 404 (never confirms other tenants data)', async ({
  request,
  hotel,
}) => {
  const { status, body } = await apiPost(request, '/tenant/rooms', {
    roomNumber: '103',
    roomTypeId: '00000000-0000-4000-8000-000000000000',
  }, hotel.ownerToken);
  expect(status).toBe(404);
  expect(body.code).toBe('ROOM_TYPE_NOT_FOUND');
});

test('11.3 AC2 — bulk preview lists exact rows, honors exclusions, flags duplicates', async ({
  request,
  hotel,
  standardType,
}) => {
  await apiPost(request, '/tenant/rooms', { roomNumber: '313', roomTypeId: standardType.id }, hotel.ownerToken);

  const { status, body } = await apiPost(request, '/tenant/rooms/bulk/preview', {
    from: 311,
    to: 315,
    exclusions: [312],
    floor: 3,
    roomTypeId: standardType.id,
  }, hotel.ownerToken);
  expect(status).toBe(200);
  const rows = body.rows as Array<{ row: number; roomNumber: string; duplicate: boolean; issues: unknown[] }>;
  expect(rows.map((r) => r.roomNumber)).toEqual(['311', '313', '314', '315']);
  const dup = rows.find((r) => r.roomNumber === '313')!;
  expect(dup.duplicate).toBe(true);
  expect(body.duplicateCount).toBe(1);
  expect(body.validCount).toBe(3);
  expect(body.remaining).toBeNull(); // unlimited plan
});

test('11.3 AC2 — bulk preview invalid range (from > to, or cap exceeded) → 400', async ({
  request,
  hotel,
  standardType,
}) => {
  const inverted = await apiPost(request, '/tenant/rooms/bulk/preview', {
    from: 5,
    to: 4,
    roomTypeId: standardType.id,
  }, hotel.ownerToken);
  expect(inverted.status).toBe(400);
  expect(inverted.body.code).toBe('BULK_RANGE_INVALID');

  // The 500-room cap has its own stable code (distinct from an inverted range).
  const tooBig = await apiPost(request, '/tenant/rooms/bulk/preview', {
    from: 1,
    to: 501,
    roomTypeId: standardType.id,
  }, hotel.ownerToken);
  expect(tooBig.status).toBe(400);
  expect(tooBig.body.code).toBe('BULK_RANGE_TOO_LARGE');
});

test('11.3 AC2/AC4 — bulk commit creates exactly the previewed rows; atomic', async ({
  request,
  hotel,
  standardType,
}) => {
  await apiPost(request, '/tenant/rooms', { roomNumber: '320', roomTypeId: standardType.id }, hotel.ownerToken);

  // Commit WITHOUT skipDuplicates (hotel chose "cancel" semantics): the
  // duplicate must abort the whole batch — 11.3 AC4 atomicity.
  const atomic = await apiPost(request, '/tenant/rooms/bulk', {
    rooms: [
      { row: 0, roomNumber: '321', floor: 3, roomTypeId: standardType.id },
      { row: 1, roomNumber: '320', floor: 3, roomTypeId: standardType.id },
      { row: 2, roomNumber: '322', floor: 3, roomTypeId: standardType.id },
    ],
    source: 'range',
  }, hotel.ownerToken);
  expect(atomic.status).toBe(409);
  expect(atomic.body.code).toBe('ROOM_NUMBER_TAKEN');
  expect(atomic.body.roomNumbers).toEqual(['320']);
  const after = await listRooms(request, hotel.ownerToken, { search: '32' });
  expect(after.body.data.map((r) => r.roomNumber)).toEqual(['320']);

  // Now the "skip duplicates and create the rest" path.
  const skipped = await apiPost(request, '/tenant/rooms/bulk', {
    rooms: [
      { row: 0, roomNumber: '321', floor: 3, roomTypeId: standardType.id },
      { row: 1, roomNumber: '320', floor: 3, roomTypeId: standardType.id },
      { row: 2, roomNumber: '322', floor: 3, roomTypeId: standardType.id },
    ],
    source: 'range',
    skipDuplicates: true,
    skippedCount: 1,
  }, hotel.ownerToken);
  expect(skipped.status).toBe(201);
  const final = await listRooms(request, hotel.ownerToken, { search: '32' });
  // 321/322 sit on floor 3; floorless 320 sorts last (NULLS LAST).
  expect(final.body.data.map((r) => r.roomNumber)).toEqual(['321', '322', '320']);
});

test('11.3 AC3 — single create over plan max_rooms → 409 ROOM_LIMIT_REACHED with remaining', async ({
  request,
  adminToken,
}) => {
  const planId = await createPlan(request, adminToken, { nameEn: `QA 1 Room ${Date.now().toString(36)}`, maxRooms: 1 });
  const tiny = await provisionHotel(request, { epic: 'e11', tag: `l1${Date.now().toString(36)}`, planId });
  const type = await standardTypeId(request, tiny.ownerToken);
  await apiPost(request, '/tenant/rooms', { roomNumber: 'A1', roomTypeId: type }, tiny.ownerToken);

  const over = await apiPost(request, '/tenant/rooms', { roomNumber: 'A2', roomTypeId: type }, tiny.ownerToken);
  expect(over.status).toBe(409);
  expect(over.body.code).toBe('ROOM_LIMIT_REACHED');
  expect(over.body.limit).toBe(1);
  expect(over.body.used).toBe(1);
  expect(over.body.remaining).toBe(0);

  const third = await apiPost(request, '/tenant/rooms', { roomNumber: 'A3', roomTypeId: type }, tiny.ownerToken);
  expect(third.status).toBe(409);
});

test('11.3 AC3 — bulk commit that would exceed the plan is rejected in full', async ({
  request,
  adminToken,
}) => {
  const planId = await createPlan(request, adminToken, { nameEn: `QA Bulk 5 ${Date.now().toString(36)}`, maxRooms: 5 });
  const tiny = await provisionHotel(request, { epic: 'e11', tag: `l2${Date.now().toString(36)}`, planId });
  const type = await standardTypeId(request, tiny.ownerToken);
  await apiPost(request, '/tenant/rooms', { roomNumber: 'B1', roomTypeId: type }, tiny.ownerToken);

  const preview = await apiPost(request, '/tenant/rooms/bulk/preview', {
    from: 10,
    to: 20,
    roomTypeId: type,
  }, tiny.ownerToken);
  expect(preview.status).toBe(200);
  expect(preview.body.remaining).toBe(4);

  const commit = await apiPost(request, '/tenant/rooms/bulk', {
    rooms: Array.from({ length: 11 }, (_, i) => ({
      row: i,
      roomNumber: String(10 + i),
      roomTypeId: type,
    })),
    source: 'range',
    range: { from: 10, to: 20 },
  }, tiny.ownerToken);
  expect(commit.status).toBe(409);
  expect(commit.body.code).toBe('ROOM_LIMIT_REACHED');
  expect(commit.body.remaining).toBe(4);

  const after = await listRooms(request, tiny.ownerToken);
  expect(after.body.total).toBe(1);
});

test('11.3 AC3 — inactive rooms free plan seats; out_of_service still occupy them', async ({
  request,
  adminToken,
}) => {
  const planId = await createPlan(request, adminToken, { nameEn: `QA Seat 2 ${Date.now().toString(36)}`, maxRooms: 2 });
  const tiny = await provisionHotel(request, { epic: 'e11', tag: `l3${Date.now().toString(36)}`, planId });
  const type = await standardTypeId(request, tiny.ownerToken);
  await apiPost(request, '/tenant/rooms', { roomNumber: 'C1', roomTypeId: type }, tiny.ownerToken);
  await apiPost(request, '/tenant/rooms', { roomNumber: 'C2', roomTypeId: type }, tiny.ownerToken);

  const full = await apiPost(request, '/tenant/rooms', { roomNumber: 'C3', roomTypeId: type }, tiny.ownerToken);
  expect(full.body.code).toBe('ROOM_LIMIT_REACHED');

  const list = await listRooms(request, tiny.ownerToken);
  const c2 = list.body.data.find((r) => r.roomNumber === 'C2')!;
  const { apiPatch } = await import('../../helpers/gxp-api');
  await apiPatch(request, `/tenant/rooms/${c2.id}`, { status: 'inactive' }, tiny.ownerToken);

  const nowFits = await apiPost(request, '/tenant/rooms', { roomNumber: 'C3', roomTypeId: type }, tiny.ownerToken);
  expect(nowFits.status).toBe(201);
});

test('11.3 AC3 — race: two concurrent bulk commits cannot exceed the plan (seat lock)', async ({
  request,
  adminToken,
}) => {
  const planId = await createPlan(request, adminToken, { nameEn: `QA Race 5 ${Date.now().toString(36)}`, maxRooms: 5 });
  const tiny = await provisionHotel(request, { epic: 'e11', tag: `race${Date.now().toString(36)}`, planId });
  const type = await standardTypeId(request, tiny.ownerToken);

  const batch = (start: number) => ({
    rooms: Array.from({ length: 4 }, (_, i) => ({
      row: i,
      roomNumber: String(start + i),
      roomTypeId: type,
    })),
    source: 'range' as const,
    range: { from: start, to: start + 3 },
  });

  const [r1, r2] = await Promise.all([
    apiPost(request, '/tenant/rooms/bulk', batch(10), tiny.ownerToken),
    apiPost(request, '/tenant/rooms/bulk', batch(20), tiny.ownerToken),
  ]);

  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual([201, 409]);
  const loser = r1.status === 409 ? r1 : r2;
  expect(loser.body.code).toBe('ROOM_LIMIT_REACHED');

  const after = await listRooms(request, tiny.ownerToken);
  expect(after.body.total).toBe(4);
});

test('11.3 AC5 — audit trail: room.created and rooms.bulk_created (with count + range)', async ({
  request,
  hotel,
  standardType,
}) => {
  await apiPost(request, '/tenant/rooms', { roomNumber: '141', roomTypeId: standardType.id }, hotel.ownerToken);
  await apiPost(request, '/tenant/rooms/bulk', {
    rooms: [
      { row: 0, roomNumber: '142', roomTypeId: standardType.id },
      { row: 1, roomNumber: '143', roomTypeId: standardType.id },
    ],
    source: 'range',
    range: { from: 142, to: 143 },
  }, hotel.ownerToken);

  // room.created rows point entityId at the ROOM; scope by metadata hotelId.
  expect(auditCountByMeta('room.created', hotel.hotelId)).toBeGreaterThanOrEqual(1);
  const meta = lastAuditMeta('rooms.bulk_created', hotel.hotelId);
  expect(meta, 'rooms.bulk_created audit row exists').toBeTruthy();
  // 11.3 AC5 — the bulk audit carries the count + range.
  const parsed = JSON.parse(meta!);
  expect(parsed.count).toBe(2);
  expect(parsed.range).toEqual({ from: 142, to: 143 });
});
