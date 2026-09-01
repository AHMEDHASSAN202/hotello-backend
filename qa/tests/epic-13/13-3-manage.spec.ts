/**
 * Epic 13 — Story 13.3 Manage a Stay (extend, edit, change room, regenerate).
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiGetRetry,
  apiPatch,
  apiPost,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import {
  checkIn,
  checkInOk,
  checkoutOk,
  guestMe,
  guestSession,
  guestSessionOk,
  guestName,
  todayPlus,
  type StayView,
} from '../../helpers/stays';
import { auditCount, lastAuditMeta } from '../../helpers/db';

let seq = 0;
async function setupRooms(
  request: Parameters<typeof apiGet>[0],
  adminToken: string,
): Promise<{ hotel: ProvisionedHotel; rooms: Record<string, string> }> {
  seq += 1;
  const hotel = await provisionHotel(request, { epic: 'e13', tag: `m${seq}${Date.now().toString(36)}`, adminToken });
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['441', '442', '443', '444', '445', '446', '447', '448', '449', '450', '451', '452'], 13);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    hotel.ownerToken,
  );
  if (!list.body.data) {
    throw new Error(`rooms list failed: ${list.status} ${JSON.stringify(list.body).slice(0, 300)}`);
  }
  const rooms: Record<string, string> = {};
  for (const room of list.body.data) {
    rooms[room.roomNumber] = room.id;
  }
  return { hotel, rooms };
}

test('13.3 AC1 — extend the stay; audit records old/new; sessions continue', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay, code } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['441'] });
  const session = await guestSessionOk(request, hotel.slug, '441', code);

  const extended = await apiPatch<{ checkOutDate?: string; code?: string }>(
    request,
    `/tenant/stays/${stay.id}`,
    { checkOutDate: todayPlus(7) },
    hotel.ownerToken,
  );
  expect(extended.status, JSON.stringify(extended.body)).toBe(200);
  expect((extended.body as unknown as StayView).checkOutDate).toBe(todayPlus(7));

  const meta = lastAuditMeta('stay.dates_changed', stay.id);
  expect(meta).toBeTruthy();
  const parsed = JSON.parse(meta!) as { checkOutDate: { from: string; to: string } };
  expect(parsed.checkOutDate.from).toBe(todayPlus(3));
  expect(parsed.checkOutDate.to).toBe(todayPlus(7));

  // The guest session survives the date change (13.3 AC1).
  const me = await guestMe(request, session.accessToken);
  expect(me.status).toBe(200);
});

test('13.3 AC1 — shortened checkout must stay > check-in and not in the past', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay } = await checkInOk(request, hotel.ownerToken, {
    roomId: rooms['442'],
    checkInDate: todayPlus(0),
    checkOutDate: todayPlus(5),
  });

  const beforeCheckIn = await apiPatch(request, `/tenant/stays/${stay.id}`, {
    checkOutDate: todayPlus(-1),
  }, hotel.ownerToken);
  expect(beforeCheckIn.status).toBe(400);
  expect((beforeCheckIn.body as { code?: string }).code).toBe('INVALID_STAY_DATES');

  // checkout == check-in is invalid too.
  const sameDay = await apiPatch(request, `/tenant/stays/${stay.id}`, {
    checkOutDate: todayPlus(0),
  }, hotel.ownerToken);
  expect(sameDay.status).toBe(400);
});

test('13.3 AC2 — change room: availability rules, code keeps working, audit', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay, code } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['443'] });
  await checkInOk(request, hotel.ownerToken, { roomId: rooms['444'] }); // occupied target

  const intoOccupied = await apiPost(request, `/tenant/stays/${stay.id}/change-room`, {
    roomId: rooms['444'],
  }, hotel.ownerToken);
  expect(intoOccupied.status).toBe(409);
  expect((intoOccupied.body as { code?: string }).code).toBe('ROOM_OCCUPIED');

  // Same room = no-op (200, nothing changes).
  const same = await apiPost(request, `/tenant/stays/${stay.id}/change-room`, {
    roomId: rooms['443'],
  }, hotel.ownerToken);
  expect(same.status).toBe(200);

  const moved = await apiPost<{ roomNumber?: string; code?: string }>(
    request,
    `/tenant/stays/${stay.id}/change-room`,
    { roomId: rooms['445'] },
    hotel.ownerToken,
  );
  expect(moved.status).toBe(200);
  expect(moved.body.roomNumber).toBe('445');

  // Old room is free again; the new room is occupied.
  const avail = await apiGet<Array<{ roomNumber: string }>>(
    request,
    '/tenant/stays/available-rooms',
    hotel.ownerToken,
  );
  const numbers = avail.body.map((r) => r.roomNumber);
  expect(numbers).toContain('443');
  expect(numbers).not.toContain('445');

  // Audit stay.room_changed with from/to.
  const meta = lastAuditMeta('stay.room_changed', stay.id);
  expect(meta).toBeTruthy();
  const roomChange = JSON.parse(meta!);
  expect(roomChange.from).toBe('443');
  expect(roomChange.to).toBe('445');

  // The SAME code now logs the guest into the NEW room.
  const session = await guestSessionOk(request, hotel.slug, '445', code);
  expect(session.profile.roomNumber).toBe('445');
  // ...and the old room+code combination is dead.
  const oldCombo = await guestSession(request, hotel.slug, '443', code);
  expect(oldCombo.status).toBe(401);
});

test('13.3 AC2 — room-change race: two concurrent moves into one free room', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const s1 = await checkInOk(request, hotel.ownerToken, { roomId: rooms['446'] });
  const s2 = await checkInOk(request, hotel.ownerToken, { roomId: rooms['447'] });

  const [r1, r2] = await Promise.all([
    apiPost(request, `/tenant/stays/${s1.stay.id}/change-room`, { roomId: rooms['448'] }, hotel.ownerToken),
    apiPost(request, `/tenant/stays/${s2.stay.id}/change-room`, { roomId: rooms['448'] }, hotel.ownerToken),
  ]);
  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual([200, 409]);
});

test('13.3 AC4 — regenerate code: old dies instantly, new works, sessions survive', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay, code } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['449'] });
  const session = await guestSessionOk(request, hotel.slug, '449', code);

  const regen = await apiPost<{ code?: string; message?: string }>(
    request,
    `/tenant/stays/${stay.id}/regenerate-code`,
    {},
    hotel.ownerToken,
  );
  expect(regen.status).toBe(200);
  const newCode = regen.body.code!;
  expect(newCode).toMatch(/^\d{6}$/);
  expect(newCode).not.toBe(code);

  // Old code dead, new code works.
  const oldLogin = await guestSession(request, hotel.slug, '449', code);
  expect(oldLogin.status).toBe(401);
  const newLogin = await guestSessionOk(request, hotel.slug, '449', newCode);

  // Existing session (opened before regeneration) keeps working.
  const me = await guestMe(request, session.accessToken);
  expect(me.status).toBe(200);
  void newLogin;

  // Audited, never with the code.
  expect(auditCount('stay.code_regenerated', stay.id)).toBe(1);
  const meta = lastAuditMeta('stay.code_regenerated', stay.id)!;
  expect(meta).not.toContain(newCode);
});

test('13.3 AC5 — edit guest info; audit stay.updated with diff', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay } = await checkInOk(request, hotel.ownerToken, {
    roomId: rooms['450'],
    language: 'en',
    guestsCount: 1,
  });

  const updated = await apiPatch<StayView & { code?: string }>(
    request,
    `/tenant/stays/${stay.id}`,
    {
      guestName: `${stay.guestName} II`,
      email: 'fixed@example.com',
      phone: '+20 111 222 3333',
      language: 'fr',
      guestsCount: 3,
      note: 'VIP',
    },
    hotel.ownerToken,
  );
  expect(updated.status).toBe(200);
  expect(updated.body).toMatchObject({
    guestName: `${stay.guestName} II`,
    email: 'fixed@example.com',
    language: 'fr',
    guestsCount: 3,
    note: 'VIP',
  });

  const meta = lastAuditMeta('stay.updated', stay.id)!;
  const diff = JSON.parse(meta).diff;
  expect(diff.language).toEqual({ from: 'en', to: 'fr' });
  expect(diff.guestsCount).toEqual({ from: 1, to: 3 });
});

test('13.3 — mutations on a checked-out stay are final (409 STAY_NOT_ACTIVE)', async ({
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['451'] });
  await checkoutOk(request, hotel.ownerToken, stay.id);

  const edit = await apiPatch(request, `/tenant/stays/${stay.id}`, { guestName: 'X' }, hotel.ownerToken);
  expect(edit.status).toBe(409);
  expect((edit.body as { code?: string }).code).toBe('STAY_NOT_ACTIVE');

  const regen = await apiPost(request, `/tenant/stays/${stay.id}/regenerate-code`, {}, hotel.ownerToken);
  expect(regen.status).toBe(409);

  const move = await apiPost(request, `/tenant/stays/${stay.id}/change-room`, { roomId: rooms['452'] }, hotel.ownerToken);
  expect(move.status).toBe(409);

  const again = await apiPost(request, `/tenant/stays/${stay.id}/checkout`, {}, hotel.ownerToken);
  expect(again.status).toBe(409);
});

test('13.3 — cross-tenant stay ids 404', async ({ request, adminToken }) => {
  const { hotel, rooms } = await setupRooms(request, adminToken);
  const { stay } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['452'] });

  const other = await provisionHotel(request, { epic: 'e13', tag: `iso${Date.now().toString(36)}`, adminToken });

  const detail = await apiGet(request, `/tenant/stays/${stay.id}`, other.ownerToken);
  expect(detail.status).toBe(404);
  const patch = await apiPatch(request, `/tenant/stays/${stay.id}`, { guestName: 'X' }, other.ownerToken);
  expect(patch.status).toBe(404);
});
