/**
 * Epic 13 — Story 13.2 Stays List & History + occupancy field-gating.
 * Fresh hotel per test: active board, floor lists and history totals are
 * only deterministic in a hotel this suite owns exclusively.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiGetRetry,
  apiPatch,
  apiPost,
  createRoomsQuickly,
  createStaffUser,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import {
  checkInOk,
  checkoutOk,
  guestName,
  listStays,
  todayPlus,
} from '../../helpers/stays';

// Paced logins (staff creation) add minutes under full-suite load.
test.setTimeout(420_000);

let seq = 0;
async function setupRooms(
  request: Parameters<typeof apiGet>[0],
  adminToken: string,
): Promise<{ hotel: ProvisionedHotel; rooms: Record<string, string> }> {
  seq += 1;
  const hotel = await provisionHotel(request, { epic: 'e13', tag: `l${seq}${Date.now().toString(36)}`, adminToken });
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['421', '422', '423', '424', '425'], 16);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    hotel.ownerToken,
  );
  const rooms: Record<string, string> = {};
  for (const room of list.body.data) {
    rooms[room.roomNumber] = room.id;
  }
  return { hotel, rooms };
}

test('13.2 AC1 — active view: fields, natural room order, search by guest and room, floor filter', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  // Deliberately check in out of numeric order.
  await checkInOk(request, hotel.ownerToken, { roomId: rooms['425'], guestName: guestName() });
  const stay101 = await checkInOk(request, hotel.ownerToken, { roomId: rooms['421'], guestName: guestName() });
  await checkInOk(request, hotel.ownerToken, { roomId: rooms['424'], guestName: guestName() });

  const active = await listStays(request, hotel.ownerToken);
  expect(active.status).toBe(200);
  expect(active.body.data.map((s) => s.roomNumber)).toEqual(['421', '424', '425']);

  const byGuest = await listStays(request, hotel.ownerToken, { search: stay101.stay.guestName.slice(-8) });
  expect(byGuest.body.data.map((s) => s.roomNumber)).toEqual(['421']);

  const byRoom = await listStays(request, hotel.ownerToken, { search: '424' });
  expect(byRoom.body.data.map((s) => s.roomNumber)).toEqual(['424']);

  const byFloor = await listStays(request, hotel.ownerToken, { floor: 16 });
  expect(byFloor.body.data.map((s) => s.roomNumber)).toEqual(['421', '424', '425']);

  // Nights remaining is computed from the hotel-local today.
  expect(active.body.data[0].nightsRemaining).toBe(3);
  expect(active.body.data[0].checkOutDate).toBe(todayPlus(3));
});

test('13.2 AC2 — history: checked-out stays with checkout type, searchable', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const a = await checkInOk(request, hotel.ownerToken, { roomId: rooms['421'], guestName: 'History Alpha' });
  const b = await checkInOk(request, hotel.ownerToken, { roomId: rooms['422'], guestName: 'History Beta' });

  await checkoutOk(request, hotel.ownerToken, a.stay.id);
  await checkoutOk(request, hotel.ownerToken, b.stay.id);

  const history = await listStays(request, hotel.ownerToken, { view: 'history' });
  expect(history.status).toBe(200);
  expect(history.body.total).toBe(2);
  // newest checkout first
  expect(history.body.data[0].guestName).toBe('History Beta');
  expect(history.body.data.every((s) => s.status === 'checked_out')).toBe(true);
  expect(history.body.data.every((s) => s.checkoutType === 'manual')).toBe(true);
  expect(history.body.data[0].checkedOutAt).toBeTruthy();

  const searched = await listStays(request, hotel.ownerToken, { view: 'history', search: 'Alpha' });
  expect(searched.body.total).toBe(1);
  expect(searched.body.data[0].guestName).toBe('History Alpha');

  const byRoomNumber = await listStays(request, hotel.ownerToken, { view: 'history', search: '421' });
  expect(byRoomNumber.body.total).toBe(1);
});

test('13.2 AC3 — occupancy rides the rooms payload only for stays.read holders', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['423'] });

  // Owner (*) sees currentStay.
  const ownerList = await apiGet<{ data: Array<{ roomNumber: string; currentStay?: { guestName: string; checkOutDate: string } | null }> }>(
    request,
    '/tenant/rooms?search=423',
    hotel.ownerToken,
  );
  const ownerRoom = ownerList.body.data.find((r) => r.roomNumber === '423')!;
  expect(ownerRoom.currentStay).toMatchObject({
    guestName: stay.guestName,
    checkOutDate: todayPlus(3),
  });

  // rooms.read-only staff must NOT get the field at all.
  const staff = await createStaffUser(request, hotel.ownerToken, hotel.slug, ['rooms.read']);
  const staffList = await apiGet<{ data: Array<{ roomNumber: string; currentStay?: unknown }> }>(
    request,
    '/tenant/rooms?search=423',
    staff.token,
  );
  const staffRoom = staffList.body.data.find((r) => r.roomNumber === '423')!;
  expect('currentStay' in staffRoom).toBe(false);
});

test('13.2 AC3 — room detail shows the current stay for stays.read holders', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['421'] });

  const detail = await apiGet<{ currentStay?: { guestName: string } | null }>(
    request,
    `/tenant/rooms/${rooms['421']}`,
    hotel.ownerToken,
  );
  expect(detail.status).toBe(200);
  expect(detail.body.currentStay?.guestName).toBe(stay.guestName);
});

test('13.2/11.4 — an occupied room cannot go out_of_service, inactive, or be renumbered', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  await checkInOk(request, hotel.ownerToken, { roomId: rooms['424'] });

  const oos = await apiPatch(request, `/tenant/rooms/${rooms['424']}`, { status: 'out_of_service' }, hotel.ownerToken);
  expect(oos.status).toBe(409);
  expect((oos.body as { code?: string }).code).toBe('ROOM_OCCUPIED');

  const inactive = await apiPatch(request, `/tenant/rooms/${rooms['424']}`, { status: 'inactive' }, hotel.ownerToken);
  expect(inactive.status).toBe(409);

  // Renumber guard activates with ANY stay history (spec decision: the Epic 11
  // stub now throws ROOM_HAS_STAY_HISTORY).
  const renumber = await apiPatch(request, `/tenant/rooms/${rooms['424']}`, { roomNumber: '499' }, hotel.ownerToken);
  expect(renumber.status).toBe(409);
  expect((renumber.body as { code?: string }).code).toBe('ROOM_HAS_STAY_HISTORY');
});

test('13.2 AC2 — stays are permanent: no delete endpoint exists', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['421'] });
  const del = await request.delete(`${process.env.GXP_API_URL ?? 'http://localhost:4000/api/v1'}/tenant/stays/${stay.id}`, {
    headers: { Authorization: `Bearer ${hotel.ownerToken}` },
  });
  expect([404, 405]).toContain(del.status());
});

test('13.1 AC1 — stays endpoints require their permissions', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  // stays.read-less user cannot list
  const staff = await createStaffUser(request, hotel.ownerToken, hotel.slug, ['rooms.read']);
  const list = await listStays(request, staff.token);
  expect(list.status).toBe(403);
  // stays.read (no checkin) cannot check in
  const reader = await createStaffUser(request, hotel.ownerToken, hotel.slug, ['stays.read']);
  const res = await apiPost(request, '/tenant/stays', {
    guestName: guestName(),
    roomId: rooms['425'],
    language: 'en',
    checkInDate: todayPlus(0),
    checkOutDate: todayPlus(2),
  }, reader.token);
  expect(res.status).toBe(403);
});
