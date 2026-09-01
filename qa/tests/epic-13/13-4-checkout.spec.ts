/**
 * Epic 13 — Story 13.4 Checkout (manual) + stay settings + guest-session kill.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPatch,
  apiPost,
  createRoomsQuickly,
  createStaffUser,
  provisionHotel,
  standardTypeId,
} from '../../helpers/gxp-api';
import {
  checkInOk,
  guestMe,
  guestSession,
  guestSessionOk,
  listStays,
  todayPlus,
  type StayView,
} from '../../helpers/stays';
import { auditCount, lastAuditMeta } from '../../helpers/db';

async function setupRooms(
  request: Parameters<typeof apiGet>[0],
  hotel: { ownerToken: string },
): Promise<Record<string, string>> {
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['461', '462', '463', '464', '465'], 14);
  const list = await apiGet(request, '/tenant/rooms?pageSize=200', hotel.ownerToken);
  const rooms: Record<string, string> = {};
  for (const room of (list.body as { data: Array<{ id: string; roomNumber: string }> }).data) {
    rooms[room.roomNumber] = room.id;
  }
  return rooms;
}

test('13.4 AC1 — manual checkout: status/type/audit, room freed instantly', async ({
  request,
  hotel,
}) => {
  const rooms = await setupRooms(request, hotel);
  const { stay, code } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['461'] });
  await guestSessionOk(request, hotel.slug, '461', code);

  const res = await apiPost<StayView & { code?: string }>(
    request,
    `/tenant/stays/${stay.id}/checkout`,
    {},
    hotel.ownerToken,
  );
  expect(res.status).toBe(200);
  const view = res.body;
  expect(view.status).toBe('checked_out');
  expect(view.checkoutType).toBe('manual');
  expect(view.checkedOutAt).toBeTruthy();

  expect(auditCount('stay.checked_out', stay.id)).toBe(1);
  const meta = JSON.parse(lastAuditMeta('stay.checked_out', stay.id)!);
  expect(meta.checkoutType).toBe('manual');

  // The room is available again — a new check-in succeeds immediately.
  const reCheckIn = await checkInOk(request, hotel.ownerToken, { roomId: rooms['461'] });
  expect(reCheckIn.stay.roomNumber).toBe('461');
  void code;
});

test('13.4 AC1/13.5 AC4 — guest session dies on the next request after checkout', async ({
  request,
  hotel,
}) => {
  const rooms = await setupRooms(request, hotel);
  const { stay, code } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['462'] });
  const session = await guestSessionOk(request, hotel.slug, '462', code);
  expect((await guestMe(request, session.accessToken)).status).toBe(200);

  await apiPost(request, `/tenant/stays/${stay.id}/checkout`, {}, hotel.ownerToken);

  // The stay check is the authority: poll briefly for the kill (spec allows a
  // short ≤30s cache, the implementation checks per request).
  let dead = false;
  for (let i = 0; i < 12 && !dead; i++) {
    dead = (await guestMe(request, session.accessToken)).status === 401;
    if (!dead) await new Promise((r) => setTimeout(r, 3000));
  }
  expect(dead, 'guest session must die after checkout').toBe(true);

  // Re-entry with the old code is also dead (stay no longer active).
  const reentry = await guestSession(request, hotel.slug, '462', code);
  expect(reentry.status).toBe(401);
  expect((reentry.body as { code?: string }).code).toBe('INVALID_CODE');
});

test('13.4 AC2 — checkout-time setting: default, edit, validation, audit', async ({
  request,
  hotel,
}) => {
  const settings = await apiGet<{ checkoutTime: string; defaultStayType?: string }>(
    request,
    '/tenant/stays/settings',
    hotel.ownerToken,
  );
  expect(settings.status).toBe(200);
  expect(settings.body.checkoutTime).toBe('12:00');

  const patched = await apiPatch<{ checkoutTime: string; code?: string }>(
    request,
    '/tenant/stays/settings',
    { checkoutTime: '14:30' },
    hotel.ownerToken,
  );
  expect(patched.status).toBe(200);
  expect(patched.body.checkoutTime).toBe('14:30');

  const invalid = await apiPatch(request, '/tenant/stays/settings', { checkoutTime: '25:99' }, hotel.ownerToken);
  expect(invalid.status).toBe(400);

  // Audited as hotel.updated with a diff.
  const meta = JSON.parse(lastAuditMeta('hotel.updated', hotel.hotelId)!);
  expect(meta.diff.checkoutTime).toEqual({ from: '12:00', to: '14:30' });
});

test('13.4 AC2 — settings are permission-gated (stays.update)', async ({
  request,
  hotel,
}) => {
  const reader = await createStaffUser(request, hotel.ownerToken, hotel.slug, ['stays.read']);
  const patched = await apiPatch(request, '/tenant/stays/settings', { checkoutTime: '15:00' }, reader.token);
  expect(patched.status).toBe(403);
});

test('13.4 — stays permissions split: checkout requires stays.checkout', async ({
  request,
  hotel,
}) => {
  const rooms = await setupRooms(request, hotel);
  const { stay } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['465'] });

  // updater without stays.checkout
  const updater = await createStaffUser(request, hotel.ownerToken, hotel.slug, [
    'stays.read',
    'stays.update',
  ]);
  const res = await apiPost(request, `/tenant/stays/${stay.id}/checkout`, {}, updater.token);
  expect(res.status).toBe(403);
});

test('13.4 AC3 — a stay past its checkout date stays active until the job runs (precondition)', async ({
  request,
  hotel,
}) => {
  // The auto-checkout job is hourly and not triggerable over HTTP — this
  // asserts the observable precondition: an expired-date stay is still active
  // beforehand and the list surfaces it. The job itself is unit-tested in the
  // backend; see the report for the coverage note.
  const rooms = await setupRooms(request, hotel);
  const { stay } = await checkInOk(request, hotel.ownerToken, {
    roomId: rooms['463'],
    checkInDate: todayPlus(-2),
    checkOutDate: todayPlus(-1),
  });
  const active = await listStays(request, hotel.ownerToken);
  expect(active.body.data.map((s) => s.id)).toContain(stay.id);
});

test('13.4 — guest tokens never pass tenant routes (third auth universe)', async ({
  request,
  hotel,
}) => {
  const rooms = await setupRooms(request, hotel);
  const { code } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['464'] });
  const session = await guestSessionOk(request, hotel.slug, '464', code);

  const tenantCall = await apiGet(request, '/tenant/rooms', session.accessToken);
  expect(tenantCall.status).toBe(401);
  const staysCall = await apiGet(request, '/tenant/stays', session.accessToken);
  expect(staysCall.status).toBe(401);
});
