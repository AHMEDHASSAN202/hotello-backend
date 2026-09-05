/**
 * Epic 16 — Story 16.8 room-charge visibility at checkout (stay drawer,
 * settlement interlock, auto-checkout non-blocking) + 16.6 AC3 guest badge.
 */
import { expect, test } from '../../fixtures';
import { apiGet, apiPatch, apiPost } from '../../helpers/gxp-api';
import { auditCount } from '../../helpers/db';
import { checkoutOk, guestSessionSteady } from '../../helpers/stays';
import {
  createItemOk,
  createMenuOk,
  createSectionOk,
  createStaffWithRole,
  checkInStay,
  guestCancelOrder,
  newGuest,
  openWindow,
  placeOrderOk,
  provisionFnbHotel,
  type FnbHotel,
} from './helpers';

let fh: FnbHotel;
let cola: { id: string };
let kitchen: { token: string };
let frontDesk: { token: string };

test.beforeAll(async ({ request, adminToken }) => {
  fh = await provisionFnbHotel(request, adminToken, `stl${Date.now().toString(36)}`, [
    '771', '772', '773', '774', '775', '776', '777', '778',
  ]);
  const token = fh.hotel.ownerToken;

  const menu = await createMenuOk(request, token, {
    nameEn: 'Minibar',
    nameAr: 'ميني بار',
    windows: [openWindow()],
    prepSlaMinutes: 10,
  });
  const section = await createSectionOk(request, token, menu.id, { nameEn: 'Drinks', nameAr: 'مشروبات' });
  cola = await createItemOk(request, token, section.id, { nameEn: 'Cola', nameAr: 'كولا', price: 60 });

  kitchen = await createStaffWithRole(request, token, fh.hotel.slug, 'F&B / Kitchen');
  frontDesk = await createStaffWithRole(request, token, fh.hotel.slug, 'Front Desk');
});

const roomChargeInput = {
  lines: [] as Array<{ itemId: string; quantity: number }>,
  destination: { type: 'room' as const },
  paymentMethod: 'room_charge',
};

const cashInput = {
  lines: [] as Array<{ itemId: string; quantity: number }>,
  destination: { type: 'room' as const },
  paymentMethod: 'cash',
};

/** Place → start → out → deliver. */
async function deliverOrder(request: Parameters<typeof apiPost>[0], token: string, orderId: string) {
  await apiPost(request, `/tenant/fnb-orders/${orderId}/start`, {}, token);
  await apiPost(request, `/tenant/fnb-orders/${orderId}/out-for-delivery`, {}, token);
  const delivered = await apiPost(request, `/tenant/fnb-orders/${orderId}/deliver`, {}, token);
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
}

async function stayOrders(request: Parameters<typeof apiGet>[0], stayId: string, token = fh.hotel.ownerToken) {
  return apiGet<{ data: Array<{ id: string; paymentMethod: string | null; status: string; totalAmount: number; settledAt: string | null }>; unsettledTotal: number } & { code?: string }>(
    request,
    `/tenant/fnb-orders/stay/${stayId}`,
    token,
  );
}

test('16.8 AC1 — the stay drawer lists orders with payment method; unsettled = delivered room-charge only', async ({
  request,
}) => {
  // Room charge is OFF by default (16.4 AC1) — this file needs it on.
  const enable = await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: true }, fh.hotel.ownerToken);
  expect(enable.status, JSON.stringify(enable.body)).toBe(200);

  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const stayId = guest.stayId;

  const cash = await placeOrderOk(request, guest.token, { ...cashInput, lines: [{ itemId: cola.id, quantity: 1 }] });
  const bill = await placeOrderOk(request, guest.token, { ...roomChargeInput, lines: [{ itemId: cola.id, quantity: 2 }] }); // 120
  const openCharge = await placeOrderOk(request, guest.token, { ...roomChargeInput, lines: [{ itemId: cola.id, quantity: 1 }] });
  const cancelledCharge = await placeOrderOk(request, guest.token, { ...roomChargeInput, lines: [{ itemId: cola.id, quantity: 3 }] });
  const cancelled = await guestCancelOrder(request, guest.token, cancelledCharge.id);
  expect(cancelled.status).toBe(200);

  await deliverOrder(request, fh.hotel.ownerToken, cash.id);
  await deliverOrder(request, fh.hotel.ownerToken, bill.id);

  const res = await stayOrders(request, stayId);
  expect(res.status).toBe(200);
  expect(res.body.data.length).toBeGreaterThanOrEqual(4);
  const byId = new Map(res.body.data.map((o) => [o.id, o]));
  expect(byId.get(cash.id)!.paymentMethod).toBe('cash');
  expect(byId.get(bill.id)!.paymentMethod).toBe('room_charge');
  expect(byId.get(openCharge.id)!.paymentMethod).toBe('room_charge');

  // 60 cash delivered + 120 room-charge delivered + 60 room-charge OPEN +
  // 180 cancelled → only the delivered room charge is "unsettled".
  expect(res.body.unsettledTotal).toBe(120);
});

test('16.8 AC2 — settle: bulk, idempotent, audited once per effective call; subset settles part', async ({
  request,
}) => {
  const { apiPatch } = await import('../../helpers/gxp-api');
  await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: true }, fh.hotel.ownerToken);

  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const a = await placeOrderOk(request, guest.token, { ...roomChargeInput, lines: [{ itemId: cola.id, quantity: 2 }] }); // 120
  await deliverOrder(request, fh.hotel.ownerToken, a.id);

  const first = await apiPost(request, `/tenant/fnb-orders/stay/${guest.stayId}/settle`, {}, fh.hotel.ownerToken);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body).toMatchObject({ settled: 1, unsettledTotal: 0 });

  const again = await apiPost(request, `/tenant/fnb-orders/stay/${guest.stayId}/settle`, {}, fh.hotel.ownerToken);
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ settled: 0, unsettledTotal: 0 });
  expect(auditCount('fnb_orders.settled', guest.stayId)).toBe(1);

  // Subset: two unsettled orders, settle one by id.
  const guest2 = await newGuest(request, fh, { stayType: 'room_only' });
  const x = await placeOrderOk(request, guest2.token, { ...roomChargeInput, lines: [{ itemId: cola.id, quantity: 1 }] }); // 60
  const y = await placeOrderOk(request, guest2.token, { ...roomChargeInput, lines: [{ itemId: cola.id, quantity: 2 }] }); // 120
  await deliverOrder(request, fh.hotel.ownerToken, x.id);
  await deliverOrder(request, fh.hotel.ownerToken, y.id);

  const partial = await apiPost(request, `/tenant/fnb-orders/stay/${guest2.stayId}/settle`, {
    orderIds: [x.id],
  }, fh.hotel.ownerToken);
  expect(partial.status).toBe(200);
  expect(partial.body).toMatchObject({ settled: 1, unsettledTotal: 120 });

  const rest = await apiPost(request, `/tenant/fnb-orders/stay/${guest2.stayId}/settle`, {}, fh.hotel.ownerToken);
  expect(rest.status).toBe(200);
  expect(rest.body).toMatchObject({ settled: 1, unsettledTotal: 0 });
  expect(auditCount('fnb_orders.settled', guest2.stayId)).toBe(2);
});

test('16.8 AC2 — the interlock is stays.checkout: kitchen refused, front desk settles', async ({
  request,
}) => {
  const { apiPatch } = await import('../../helpers/gxp-api');
  await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: true }, fh.hotel.ownerToken);

  const kitchenGuest = await newGuest(request, fh, { stayType: 'room_only' });
  const kOrder = await placeOrderOk(request, kitchenGuest.token, {
    ...roomChargeInput,
    lines: [{ itemId: cola.id, quantity: 1 }],
  });
  await deliverOrder(request, fh.hotel.ownerToken, kOrder.id);
  const denied = await apiPost(
    request,
    `/tenant/fnb-orders/stay/${kitchenGuest.stayId}/settle`,
    {},
    kitchen.token,
  );
  expect(denied.status).toBe(403);

  const fdGuest = await newGuest(request, fh, { stayType: 'room_only' });
  const fdOrder = await placeOrderOk(request, fdGuest.token, {
    ...roomChargeInput,
    lines: [{ itemId: cola.id, quantity: 1 }],
  });
  await deliverOrder(request, fh.hotel.ownerToken, fdOrder.id);
  const allowed = await apiPost(
    request,
    `/tenant/fnb-orders/stay/${fdGuest.stayId}/settle`,
    {},
    frontDesk.token,
  );
  expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  expect(allowed.body).toMatchObject({ settled: 1, unsettledTotal: 0 });
});

test('16.8 AC2 — auto-checkout does not block and never settles; charges stay flagged for follow-up', async ({
  request,
}) => {
  const { apiPatch } = await import('../../helpers/gxp-api');
  await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: true }, fh.hotel.ownerToken);

  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const order = await placeOrderOk(request, guest.token, {
    ...roomChargeInput,
    lines: [{ itemId: cola.id, quantity: 2 }],
  });
  await deliverOrder(request, fh.hotel.ownerToken, order.id);

  const stay = await checkoutOk(request, fh.hotel.ownerToken, guest.stayId);
  expect(stay.status).toBe('checked_out');

  const after = await stayOrders(request, guest.stayId);
  const row = after.body.data.find((o) => o.id === order.id)!;
  expect(row.settledAt).toBeNull(); // auto-checkout left it unsettled
  expect(after.body.unsettledTotal).toBe(120); // still visible in stay history
});

test('16.6 AC3 — the guest sees the room-bill badge flip: settled false → true after collection', async ({
  request,
}) => {
  const { apiPatch } = await import('../../helpers/gxp-api');
  await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: true }, fh.hotel.ownerToken);

  // Fresh stay, kept re-enterable by room + code (guest JWTs live 15 min).
  const roomNumber = fh.nextRoom();
  const { code } = await checkInStay(request, fh.hotel.ownerToken, {
    roomId: fh.rooms[roomNumber]!,
    stayType: 'room_only',
  });
  const first = await guestSessionSteady(request, fh.hotel.slug, roomNumber, code);
  expect(first.status).toBe(200);
  const token = (first.body as unknown as { accessToken: string }).accessToken;

  const order = await placeOrderOk(request, token, {
    ...roomChargeInput,
    lines: [{ itemId: cola.id, quantity: 1 }],
  });
  await deliverOrder(request, fh.hotel.ownerToken, order.id);

  const before = await apiGet<{ data: Array<{ id: string; settled: boolean; paymentMethod: string | null; totalAmount: number }> }>(
    request,
    '/guest/fnb/orders',
    token,
  );
  let row = before.body.data.find((o) => o.id === order.id)!;
  expect(row.paymentMethod).toBe('room_charge');
  expect(row.settled).toBe(false);

  const settle = await apiPost(request, `/tenant/fnb-orders/stay/${(first.body as unknown as { profile: { stayId: string } }).profile.stayId}/settle`, {}, fh.hotel.ownerToken);
  expect(settle.status).toBe(200);

  const after = await apiGet<{ data: Array<{ id: string; settled: boolean }> }>(
    request,
    '/guest/fnb/orders',
    token,
  );
  const settledRow = after.body.data.find((o) => o.id === order.id)!;
  expect(settledRow.settled).toBe(true);
});
