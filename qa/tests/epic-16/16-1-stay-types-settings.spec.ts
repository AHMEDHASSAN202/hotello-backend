/**
 * Epic 16 — Story 16.1 stay types + Story 16.4 payment-methods settings.
 */
import { expect, test } from '../../fixtures';
import { apiGet, apiPatch } from '../../helpers/gxp-api';
import { lastAuditMetaByMeta } from '../../helpers/db';
import { todayPlus } from '../../helpers/stays';
import {
  checkInStay,
  newGuest,
  provisionFnbHotel,
  type FnbHotel,
} from './helpers';

let fh: FnbHotel;

test.beforeAll(async ({ request, adminToken }) => {
  fh = await provisionFnbHotel(request, adminToken, `stay${Date.now().toString(36)}`, ['701', '702', '703', '704', '705', '706']);
});

test('16.1 AC1 — check-in records an explicit stay type; invalid values rejected', async ({
  request,
}) => {
  const ok = await checkInStay(request, fh.hotel.ownerToken, {
    roomId: fh.rooms[fh.nextRoom()]!,
    stayType: 'all_inclusive',
    guestName: 'AI Guest',
  });
  expect(ok.stay.stayType).toBe('all_inclusive');

  const bad = await apiPost16(request, '/tenant/stays', {
    guestName: 'Bad Board Basis',
    roomId: fh.rooms[fh.nextRoom()]!,
    language: 'en',
    checkInDate: todayPlus(0),
    checkOutDate: todayPlus(3),
    stayType: 'ultra_all_inclusive',
  });
  expect(bad.status).toBe(400);
});

test('16.1 AC1 — editing stayType later lands in the stay.updated audit diff', async ({
  request,
}) => {
  const { stay } = await checkInStay(request, fh.hotel.ownerToken, {
    roomId: fh.rooms[fh.nextRoom()]!,
    stayType: 'room_only',
  });
  const patched = await apiPatch(request, `/tenant/stays/${stay.id}`, {
    stayType: 'half_board',
  }, fh.hotel.ownerToken);
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);

  const meta = lastAuditMetaByMeta('stay.updated', fh.hotel.hotelId);
  expect(meta, 'stay.updated audit exists').toBeTruthy();
  const parsed = JSON.parse(meta!) as { diff?: { stayType?: { from: string; to: string } } };
  expect(parsed.diff?.stayType).toEqual({ from: 'room_only', to: 'half_board' });
});

test('16.1 AC2 — the hotel default stay type pre-selects at check-in', async ({
  request,
}) => {
  const before = await apiGet<{ defaultStayType?: string } & Record<string, unknown>>(
    request,
    '/tenant/stays/settings',
    fh.hotel.ownerToken,
  );
  expect(before.status).toBe(200);

  const set = await apiPatch(request, '/tenant/stays/settings', {
    checkoutTime: '12:00',
    defaultStayType: 'all_inclusive',
  }, fh.hotel.ownerToken);
  expect(set.status, JSON.stringify(set.body)).toBe(200);

  const after = await apiGet<{ defaultStayType?: string }>(request, '/tenant/stays/settings', fh.hotel.ownerToken);
  expect(after.body.defaultStayType).toBe('all_inclusive');

  // Check-in WITHOUT an explicit stay type inherits the hotel default.
  const { stay } = await checkInStay(request, fh.hotel.ownerToken, {
    roomId: fh.rooms[fh.nextRoom()]!,
  });
  expect(stay.stayType).toBe('all_inclusive');
});

test('16.1 AC4 — the guest session profile exposes stayType (+ stayId, the cart key)', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'bed_breakfast' });
  expect(guest.profile.stayType).toBe('bed_breakfast');
  expect(guest.profile.stayId).toBe(guest.stayId);
});

test('16.4 AC1 — payment methods: cash always on, room charge is the opt-in toggle', async ({
  request,
}) => {
  const settings = await apiGet<{ cashEnabled: boolean; roomChargeEnabled: boolean }>(
    request,
    '/tenant/fnb/settings',
    fh.hotel.ownerToken,
  );
  expect(settings.status).toBe(200);
  expect(settings.body.cashEnabled).toBe(true);
  expect(settings.body.roomChargeEnabled).toBe(false); // default: cash only

  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const catalog = await import('./helpers').then((m) => m.guestMenus(request, guest.token));
  expect(catalog.paymentMethods).toEqual(['cash']);

  const on = await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: true }, fh.hotel.ownerToken);
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  const withCharge = await import('./helpers').then((m) => m.guestMenus(request, guest.token));
  expect(withCharge.paymentMethods).toEqual(['cash', 'room_charge']);

  const off = await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: false }, fh.hotel.ownerToken);
  expect(off.status).toBe(200);
  const back = await import('./helpers').then((m) => m.guestMenus(request, guest.token));
  expect(back.paymentMethods).toEqual(['cash']);
});

// ------------------------------------------------------------------ utilities

async function apiPost16(
  request: Parameters<typeof apiGet>[0],
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { apiPost } = await import('../../helpers/gxp-api');
  return apiPost(request, path, body, fh.hotel.ownerToken);
}
