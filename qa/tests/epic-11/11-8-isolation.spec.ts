/**
 * Epic 11 — cross-tenant isolation (the #1 correctness rule) + per-hotel
 * room-number uniqueness.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPatch,
  apiPost,
  provisionHotel,
  createRoomsQuickly,
  listRooms,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';

test('cross-tenant — another hotel room detail/update → 404 (never 403)', async ({
  request,
  adminToken,
  hotel,
  standardType,
}) => {
  const other: ProvisionedHotel = await provisionHotel(request, {
    epic: 'e11',
    tag: `iso${Date.now().toString(36)}`,
    adminToken,
  });
  const otherType = await standardTypeId(request, other.ownerToken);
  await createRoomsQuickly(request, other.ownerToken, otherType, ['101'], 1);
  const otherList = await listRooms(request, other.ownerToken);
  const otherRoom = otherList.body.data[0];

  // Hotel A (owner fixture) pokes at hotel B's room.
  const detail = await apiGet(request, `/tenant/rooms/${otherRoom.id}`, hotel.ownerToken);
  expect(detail.status).toBe(404);
  expect(detail.body.code).toBe('ROOM_NOT_FOUND');

  const patch = await apiPatch(request, `/tenant/rooms/${otherRoom.id}`, { floor: 99 }, hotel.ownerToken);
  expect(patch.status).toBe(404);

  const qr = await apiGet(request, `/tenant/rooms/${otherRoom.id}/qr`, hotel.ownerToken);
  expect(qr.status).toBe(404);
});

test('cross-tenant — room lists never leak the other hotel rooms', async ({
  request,
  adminToken,
  hotel,
  standardType,
}) => {
  const other: ProvisionedHotel = await provisionHotel(request, {
    epic: 'e11',
    tag: `leak${Date.now().toString(36)}`,
    adminToken,
  });
  const otherType = await standardTypeId(request, other.ownerToken);
  await createRoomsQuickly(request, other.ownerToken, otherType, ['777'], 7);

  const mine = await listRooms(request, hotel.ownerToken);
  // This worker's hotel may legitimately hold its own rooms — it must never
  // hold the other hotel's.
  expect(mine.body.data.map((r) => r.roomNumber)).not.toContain('777');
});

test('room numbers are unique per hotel — the same number in two hotels is fine', async ({
  request,
  adminToken,
  hotel,
  standardType,
}) => {
  const other: ProvisionedHotel = await provisionHotel(request, {
    epic: 'e11',
    tag: `dup${Date.now().toString(36)}`,
    adminToken,
  });
  const otherType = await standardTypeId(request, other.ownerToken);
  await apiPost(request, '/tenant/rooms', { roomNumber: '424', roomTypeId: standardType.id }, hotel.ownerToken);
  const sameNumberOtherHotel = await apiPost(
    request,
    '/tenant/rooms',
    { roomNumber: '424', roomTypeId: otherType },
    other.ownerToken,
  );
  expect(sameNumberOtherHotel.status).toBe(201);

  const roomTypeNames = await apiGet<{ data: Array<{ nameEn: string }> }>(
    request,
    '/tenant/room-types',
    other.ownerToken,
  );
  // Room TYPES are per-hotel too: hotel B seeds its own Standard.
  expect(roomTypeNames.body.data.map((t) => t.nameEn)).toContain('Standard');
});

test('an admin token never passes a tenant route (separate auth universes)', async ({
  request,
  adminToken,
}) => {
  const res = await apiGet(request, '/tenant/rooms', adminToken);
  expect(res.status).toBe(401);
});
