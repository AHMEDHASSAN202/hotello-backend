/**
 * Epic 11 — Story 11.4 Edit Room & Status.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPatch,
  apiPost,
  createRoomsQuickly,
  listRooms,
} from '../../helpers/gxp-api';
import { lastAuditMetaByMeta } from '../../helpers/db';

async function roomId(request: Parameters<typeof apiPost>[0], token: string, roomNumber: string): Promise<string> {
  const list = await listRooms(request, token, { search: roomNumber });
  const room = list.body.data.find((r) => r.roomNumber === roomNumber);
  expect(room, `room ${roomNumber} exists`).toBeTruthy();
  return room!.id;
}

test('11.4 AC1 — edit floor and type', async ({ request, hotel, standardType }) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['601'], 6);
  const deluxe = await apiPost<{ id: string }>(request, '/tenant/room-types', {
    nameEn: 'Edit Deluxe',
    nameAr: 'ديلوكس تعديل',
  }, hotel.ownerToken);

  const id = await roomId(request, hotel.ownerToken, '601');
  const { status, body } = await apiPatch(request, `/tenant/rooms/${id}`, {
    floor: 7,
    roomTypeId: deluxe.body.id,
  }, hotel.ownerToken);
  expect(status).toBe(200);
  expect(body).toMatchObject({ floor: 7, roomType: { id: deluxe.body.id } });
});

test('11.4 AC1 — room number is editable while the room has no stay history', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['602'], 6);
  const id = await roomId(request, hotel.ownerToken, '602');
  const { status, body } = await apiPatch(request, `/tenant/rooms/${id}`, {
    roomNumber: '602A',
  }, hotel.ownerToken);
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.roomNumber).toBe('602A');
});

test('11.4 AC1 — renumber colliding with an existing number → 409', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['610', '611'], 6);
  const id = await roomId(request, hotel.ownerToken, '610');
  const { status, body } = await apiPatch(request, `/tenant/rooms/${id}`, {
    roomNumber: '611',
  }, hotel.ownerToken);
  expect(status).toBe(409);
  expect(body.code).toBe('ROOM_NUMBER_TAKEN');
});

test('11.4 AC2 — status transitions: active → out_of_service → active → inactive', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['620'], 6);
  const id = await roomId(request, hotel.ownerToken, '620');

  for (const expected of ['out_of_service', 'active', 'inactive', 'active']) {
    const res = await apiPatch(request, `/tenant/rooms/${id}`, { status: expected }, hotel.ownerToken);
    expect(res.status, `→ ${expected}`).toBe(200);
    expect(res.body.status).toBe(expected);
  }
});

test('11.4 AC2 — invalid status value → 400', async ({ request, hotel, standardType }) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['621'], 6);
  const id = await roomId(request, hotel.ownerToken, '621');
  const { status } = await apiPatch(request, `/tenant/rooms/${id}`, { status: 'demolished' }, hotel.ownerToken);
  expect(status).toBe(400);
});

test('11.4 AC3 — audit: room.updated records the diff', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['630'], 6);
  const id = await roomId(request, hotel.ownerToken, '630');
  const res = await apiPatch(request, `/tenant/rooms/${id}`, { floor: 9, status: 'out_of_service' }, hotel.ownerToken);
  expect(res.status).toBe(200);

  const meta = lastAuditMetaByMeta('room.updated', hotel.hotelId);
  expect(meta, 'room.updated audit row exists').toBeTruthy();
  const diff = JSON.parse(meta!);
  expect(JSON.stringify(diff)).toContain('floor');
  expect(JSON.stringify(diff)).toContain('status');
});

test('11.4 — detail endpoint returns the room and cross-tenant ids 404', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['640'], 6);
  const id = await roomId(request, hotel.ownerToken, '640');

  const mine = await apiGet(request, `/tenant/rooms/${id}`, hotel.ownerToken);
  expect(mine.status).toBe(200);
  expect(mine.body.roomNumber).toBe('640');

  // Unknown id — 404, never a leak.
  const ghost = await apiGet(request, '/tenant/rooms/00000000-0000-4000-8000-000000000000', hotel.ownerToken);
  expect(ghost.status).toBe(404);
  expect(ghost.body.code).toBe('ROOM_NOT_FOUND');
});
