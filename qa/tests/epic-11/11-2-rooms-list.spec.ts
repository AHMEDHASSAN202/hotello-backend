/**
 * Epic 11 — Story 11.2 Rooms List (API-level; UI checks live in 11-9-ui).
 * Each test provisions its OWN hotel: list semantics (order, filters,
 * counts) are only deterministic in a roomless hotel.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPatch,
  apiPost,
  createRoomsQuickly,
  createStaffUser,
  listRoomTypes,
  listRooms,
  provisionHotel,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';

/** Fresh hotel + its seeded Standard type, per test. */
async function freshHotel(
  request: Parameters<typeof apiPost>[0],
  adminToken: string,
  tag: string,
): Promise<{ hotel: ProvisionedHotel; standardTypeId: string }> {
  const hotel = await provisionHotel(request, { epic: 'e11', tag });
  const types = await listRoomTypes(request, hotel.ownerToken);
  const standard = types.find((t) => t.nameEn === 'Standard')!;
  return { hotel, standardTypeId: standard.id };
}

test('11.2 AC2 — list returns rooms with number/floor/type/status', async ({
  request,
  adminToken,
}) => {
  const { hotel, standardTypeId } = await freshHotel(request, adminToken, `list${Date.now().toString(36)}`);
  await createRoomsQuickly(request, hotel.ownerToken, standardTypeId, ['201', '202'], 2);
  const { status, body } = await listRooms(request, hotel.ownerToken);
  expect(status).toBe(200);
  expect(body.data).toHaveLength(2);
  for (const room of body.data) {
    expect(room).toMatchObject({
      roomNumber: expect.any(String),
      floor: 2,
      status: 'active',
    });
    expect(room.roomType?.id).toBe(standardTypeId);
  }
});

test('11.2 AC2 — natural sort: 2, 7, 10, 99, 101, 101A, 110 — never lexicographic', async ({
  request,
  adminToken,
}) => {
  const { hotel, standardTypeId } = await freshHotel(request, adminToken, `sort${Date.now().toString(36)}`);
  await createRoomsQuickly(
    request,
    hotel.ownerToken,
    standardTypeId,
    ['101', '110', '102', '2', '10', '20', '99', '100', '7', '101A', '007'],
    1,
  );
  const { body } = await listRooms(request, hotel.ownerToken);
  const numbers = body.data.map((r) => r.roomNumber);
  // Numeric-aware: 2 < 7 < 10 < 20 < 99 < 100 < 101 < 110. '007' shares the
  // numeric prefix of '7' (leading zeros survive as data); the 101 vs 101A
  // tie goes to the shorter number first.
  expect(numbers).toEqual([
    '2',
    '007',
    '7',
    '10',
    '20',
    '99',
    '100',
    '101',
    '101A',
    '102',
    '110',
  ]);
});

test('11.2 AC2 — unset floors sort last; floors sort ascending', async ({
  request,
  adminToken,
}) => {
  const { hotel, standardTypeId } = await freshHotel(request, adminToken, `floor${Date.now().toString(36)}`);
  await apiPost(request, '/tenant/rooms', { roomNumber: 'N1', roomTypeId: standardTypeId }, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, standardTypeId, ['5', '6'], 3);
  await createRoomsQuickly(request, hotel.ownerToken, standardTypeId, ['1', '2'], -2);
  const { body } = await listRooms(request, hotel.ownerToken);
  const floors = body.data.map((r) => r.floor);
  expect(floors).toEqual([-2, -2, 3, 3, null]);
});

test('11.2 AC2 — filter by floor, type and status; search by room number', async ({
  request,
  adminToken,
}) => {
  const { hotel, standardTypeId } = await freshHotel(request, adminToken, `filt${Date.now().toString(36)}`);
  const deluxe = await apiPost<{ id: string }>(request, '/tenant/room-types', {
    nameEn: 'Filter Deluxe',
    nameAr: 'فلتر ديلوكس',
  }, hotel.ownerToken);
  expect(deluxe.status, JSON.stringify(deluxe.body)).toBe(201);
  await createRoomsQuickly(request, hotel.ownerToken, standardTypeId, ['301', '302'], 3);
  await createRoomsQuickly(request, hotel.ownerToken, deluxe.body.id, ['303'], 3);
  await apiPost(
    request,
    '/tenant/rooms',
    { roomNumber: '304', floor: 3, roomTypeId: deluxe.body.id, status: 'out_of_service' },
    hotel.ownerToken,
  );
  const inactive = await listRooms(request, hotel.ownerToken, { search: '302' });
  await apiPatch(
    request,
    `/tenant/rooms/${inactive.body.data[0]!.id}`,
    { status: 'inactive' },
    hotel.ownerToken,
  );

  const byFloor = await listRooms(request, hotel.ownerToken, { floor: 3 });
  expect(byFloor.body.total).toBe(4);

  const byType = await listRooms(request, hotel.ownerToken, { typeId: deluxe.body.id });
  expect(byType.body.data.map((r) => r.roomNumber).sort()).toEqual(['303', '304']);

  const byStatus = await listRooms(request, hotel.ownerToken, { status: 'out_of_service' });
  expect(byStatus.body.data.map((r) => r.roomNumber)).toEqual(['304']);

  const search = await listRooms(request, hotel.ownerToken, { search: '303' });
  expect(search.body.data.map((r) => r.roomNumber)).toEqual(['303']);
});

test('11.2 AC3 — usage counter: active + out_of_service count; inactive does not', async ({
  request,
  adminToken,
}) => {
  const { hotel, standardTypeId } = await freshHotel(request, adminToken, `usag${Date.now().toString(36)}`);
  await createRoomsQuickly(request, hotel.ownerToken, standardTypeId, ['401', '402'], 4);
  await apiPost(
    request,
    '/tenant/rooms',
    { roomNumber: '403', floor: 4, roomTypeId: standardTypeId, status: 'out_of_service' },
    hotel.ownerToken,
  );
  await createRoomsQuickly(request, hotel.ownerToken, standardTypeId, ['404'], 4);
  const list = await listRooms(request, hotel.ownerToken, { search: '404' });
  await apiPatch(
    request,
    `/tenant/rooms/${list.body.data[0]!.id}`,
    { status: 'inactive' },
    hotel.ownerToken,
  );

  const { body } = await listRooms(request, hotel.ownerToken);
  expect(body.usage).toEqual({ used: 3, max: null });
});

test('11.2 AC1 — a user without rooms.read gets 403 on rooms endpoints', async ({
  request,
  adminToken,
}) => {
  const { hotel } = await freshHotel(request, adminToken, `perm${Date.now().toString(36)}`);
  const staff = await createStaffUser(request, hotel.ownerToken, hotel.slug, [
    'staff.read',
    'roles.read',
  ]);
  const rooms = await apiGet(request, '/tenant/rooms', staff.token);
  expect(rooms.status).toBe(403);
  const types = await apiGet(request, '/tenant/room-types', staff.token);
  expect(types.status).toBe(403);
  const qr = await apiGet(request, '/tenant/rooms/qr/general', staff.token);
  expect(qr.status).toBe(403);
});

test('11.2 AC1 — a user with rooms.read but not rooms.create cannot create', async ({
  request,
  adminToken,
}) => {
  const { hotel, standardTypeId } = await freshHotel(request, adminToken, `cper${Date.now().toString(36)}`);
  const staff = await createStaffUser(request, hotel.ownerToken, hotel.slug, ['rooms.read']);
  const { status, body } = await apiPost(request, '/tenant/rooms', {
    roomNumber: '999',
    roomTypeId: standardTypeId,
  }, staff.token);
  expect(status).toBe(403);
  expect((body as { code?: string }).code ?? body.message ?? body).toBeTruthy();
});
