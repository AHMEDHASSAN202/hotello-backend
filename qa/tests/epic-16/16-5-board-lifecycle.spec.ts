/**
 * Epic 16 — Story 16.7 kitchen board, lifecycle/assignment, filters/stats,
 * audits + Story 16.6 guest tracking (API) + cross-tenant isolation.
 */
import { expect, test } from '../../fixtures';
import { apiGet, apiPatch, apiPost } from '../../helpers/gxp-api';
import { auditCount, lastAuditMeta, sql } from '../../helpers/db';
import {
  createItemOk,
  createLocationOk,
  createMenuOk,
  createSectionOk,
  createStaffWithRole,
  fnbBoard,
  guestCancelOrder,
  guestOrders,
  newGuest,
  openWindow,
  placeOrderOk,
  provisionFnbHotel,
  type FnbHotel,
} from './helpers';

let fh: FnbHotel;
let other: FnbHotel;
let menuId: string;
let tea: { id: string };
let cake: { id: string };
let water: { id: string };
let lobby: { id: string };
let kitchen: { token: string; name: string };
let frontDesk: { token: string; name: string };

const SLA = 15;

test.beforeAll(async ({ request, adminToken }) => {
  fh = await provisionFnbHotel(request, adminToken, `brd${Date.now().toString(36)}`, [
    '751', '752', '753', '754', '755', '756', '757', '758', '759', '760', '761', '762',
  ]);
  other = await provisionFnbHotel(request, adminToken, `brdB${Date.now().toString(36)}`, ['792']);

  const token = fh.hotel.ownerToken;
  const menu = await createMenuOk(request, token, {
    nameEn: 'Board Menu',
    nameAr: 'قائمة المطبخ',
    windows: [openWindow()],
    prepSlaMinutes: SLA,
  });
  menuId = menu.id;
  const section = await createSectionOk(request, token, menu.id, { nameEn: 'S', nameAr: 'ق' });
  tea = await createItemOk(request, token, section.id, { nameEn: 'Pot of Tea', nameAr: 'إبريق شاي', price: 25 });
  cake = await createItemOk(request, token, section.id, { nameEn: 'Cake Slice', nameAr: 'قطعة كيك', price: 55 });

  const ai = await createMenuOk(request, token, {
    nameEn: 'AI Water',
    nameAr: 'ماء شامل',
    windows: [openWindow()],
    defaultIncludedFor: ['all_inclusive'],
    prepSlaMinutes: 10,
  });
  const aiSection = await createSectionOk(request, token, ai.id, { nameEn: 'S', nameAr: 'ق' });
  water = await createItemOk(request, token, aiSection.id, { nameEn: 'Still Water', nameAr: 'ماء', price: 15 });

  lobby = await createLocationOk(request, token, { nameEn: 'Lobby Bar', nameAr: 'لوبي بار' });

  kitchen = await createStaffWithRole(request, token, fh.hotel.slug, 'F&B / Kitchen');
  frontDesk = await createStaffWithRole(request, token, fh.hotel.slug, 'Front Desk');
});

const paidInput = (itemId: string, quantity = 1) => ({
  lines: [{ itemId, quantity }],
  destination: { type: 'room' as const },
  paymentMethod: 'cash',
});

test('16.7 AC1 — the board mirrors a new order: room, guest, language, lines, destination, dueAt, counts', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only', guestName: 'Board Anatomy Guest' });
  const t0 = Date.now();
  const order = await placeOrderOk(request, guest.token, {
    lines: [
      { itemId: tea.id, quantity: 2, note: 'with mint' },
      { itemId: water.id, quantity: 1 },
    ],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  const t1 = Date.now();

  const res = await fnbBoard(request, fh.hotel.ownerToken);
  expect(res.status).toBe(200);
  const row = res.body.data.find((o) => o.id === order.id);
  expect(row, 'order on the open board').toBeTruthy();
  expect(row!.roomNumber).toBe(guest.roomNumber);
  expect(row!.guestName).toBe('Board Anatomy Guest');
  expect(row!.guestLanguage).toBe('en');
  expect(row!.status).toBe('new');
  expect(row!.destinationType).toBe('room');
  expect(row!.paymentMethod).toBe('cash');
  expect(row!.totalAmount).toBe(50); // included water at 0
  expect(row!.slaTargetMinutes).toBe(SLA);

  const teaLine = row!.lines.find((l) => l.itemNameEn === 'Pot of Tea')!;
  expect(teaLine.itemNameAr).toBe('إبريق شاي');
  expect(teaLine.itemName).toBe('Pot of Tea'); // guest-language name
  expect(teaLine.quantity).toBe(2);
  expect(teaLine.note).toBe('with mint');
  const waterLine = row!.lines.find((l) => l.itemNameEn === 'Still Water')!;
  expect(waterLine.included).toBe(true);
  expect(waterLine.unitPrice).toBe(0);

  // dueAt = placed + SLA (dueAt is timestamptz — a true instant; compare to
  // the test clock, not to the naive createdAt column).
  const due = Date.parse(String(row!.dueAt));
  expect(due).toBeGreaterThanOrEqual(t0 + SLA * 60_000 - 5_000);
  expect(due).toBeLessThanOrEqual(t1 + SLA * 60_000 + 5_000);

  const counts = res.body.counts!;
  expect(counts.open).toBeGreaterThanOrEqual(1);
  expect(counts).toHaveProperty('deliveredToday');
  expect(counts).toHaveProperty('overdueNow');
  expect(counts).toHaveProperty('revenueToday');
});

test('16.7 AC2 — lifecycle: start (auto-claims) → out → delivered; timestamps + invalid moves 409', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const order = await placeOrderOk(request, guest.token, paidInput(tea.id));

  // on_the_way cannot be reached from new.
  const earlyOut = await apiPost(request, `/tenant/fnb-orders/${order.id}/out-for-delivery`, {}, fh.hotel.ownerToken);
  expect(earlyOut.status).toBe(409);
  expect((earlyOut.body as { code?: string }).code).toBe('FNB_ORDER_INVALID_STATUS');

  // Guests lose the cancel right the moment the kitchen starts.
  await apiPost(request, `/tenant/fnb-orders/${order.id}/start`, {}, fh.hotel.ownerToken);
  const guestCancel = await guestCancelOrder(request, guest.token, order.id);
  expect(guestCancel.status).toBe(409);
  expect(guestCancel.body.code).toBe('FNB_ORDER_INVALID_STATUS');

  const started = await apiGet(request, `/tenant/fnb-orders/${order.id}`, fh.hotel.ownerToken);
  let body = started.body as unknown as { status: string; startedAt: string | null; assignedTo: { id: string } | null };
  expect(body.status).toBe('preparing');
  expect(body.startedAt).toBeTruthy();
  expect(body.assignedTo, 'starting claims the unowned ticket').toBeTruthy();

  const deliveredEarly = await apiPost(request, `/tenant/fnb-orders/${order.id}/deliver`, {}, fh.hotel.ownerToken);
  expect(deliveredEarly.status).toBe(409);

  const out = await apiPost(request, `/tenant/fnb-orders/${order.id}/out-for-delivery`, {}, fh.hotel.ownerToken);
  expect(out.status).toBe(200);
  const repeatOut = await apiPost(request, `/tenant/fnb-orders/${order.id}/out-for-delivery`, {}, fh.hotel.ownerToken);
  expect(repeatOut.status).toBe(409);

  const deliver = await apiPost(request, `/tenant/fnb-orders/${order.id}/deliver`, {}, fh.hotel.ownerToken);
  expect(deliver.status).toBe(200);
  body = deliver.body as typeof body;
  expect(body.status).toBe('delivered');

  const restart = await apiPost(request, `/tenant/fnb-orders/${order.id}/start`, {}, fh.hotel.ownerToken);
  expect(restart.status).toBe(409);
  const recancel = await apiPost(request, `/tenant/fnb-orders/${order.id}/cancel`, {
    reason: 'out_of_stock',
  }, fh.hotel.ownerToken);
  expect(recancel.status).toBe(409);
});

test('16.7 AC2 — staff cancel matrix (reasons, other+note, from preparing); guest cancel new-only', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });

  const o1 = await placeOrderOk(request, guest.token, paidInput(tea.id));
  const c1 = await apiPost(request, `/tenant/fnb-orders/${o1.id}/cancel`, {
    reason: 'out_of_stock',
  }, fh.hotel.ownerToken);
  expect(c1.status).toBe(200);
  expect((c1.body as { cancelledReason?: string }).cancelledReason).toBe('out_of_stock');

  const o2 = await placeOrderOk(request, guest.token, paidInput(tea.id));
  const noNote = await apiPost(request, `/tenant/fnb-orders/${o2.id}/cancel`, {
    reason: 'other',
  }, fh.hotel.ownerToken);
  expect(noNote.status).toBe(400);
  const c2 = await apiPost(request, `/tenant/fnb-orders/${o2.id}/cancel`, {
    reason: 'other',
    note: 'Kitchen deep-clean',
  }, fh.hotel.ownerToken);
  expect(c2.status).toBe(200);
  expect((c2.body as { cancelNote?: string }).cancelNote).toBe('Kitchen deep-clean');

  const o3 = await placeOrderOk(request, guest.token, paidInput(tea.id));
  await apiPost(request, `/tenant/fnb-orders/${o3.id}/start`, {}, fh.hotel.ownerToken);
  const c3 = await apiPost(request, `/tenant/fnb-orders/${o3.id}/cancel`, {
    reason: 'kitchen_closed',
  }, fh.hotel.ownerToken);
  expect(c3.status, 'staff can still cancel while preparing').toBe(200);

  const o4 = await placeOrderOk(request, guest.token, paidInput(tea.id));
  await apiPost(request, `/tenant/fnb-orders/${o4.id}/start`, {}, fh.hotel.ownerToken);
  await apiPost(request, `/tenant/fnb-orders/${o4.id}/out-for-delivery`, {}, fh.hotel.ownerToken);
  const staffLate = await apiPost(request, `/tenant/fnb-orders/${o4.id}/cancel`, {
    reason: 'guest_request',
  }, fh.hotel.ownerToken);
  expect(staffLate.status).toBe(409);
  const guestLate = await guestCancelOrder(request, guest.token, o4.id);
  expect(guestLate.status).toBe(409);

  const o5 = await placeOrderOk(request, guest.token, paidInput(tea.id));
  const guestOk = await guestCancelOrder(request, guest.token, o5.id);
  expect(guestOk.status).toBe(200);
  expect(guestOk.body.status).toBe('cancelled');
  expect(guestOk.body.cancelledReason).toBe('guest');

  // A guest cannot touch another stay's order — 404, no existence leak.
  const stranger = await newGuest(request, fh, { stayType: 'room_only' });
  const foreign = await guestCancelOrder(request, stranger.token, o5.id);
  expect(foreign.status).toBe(404);
  expect(foreign.body.code).toBe('FNB_ORDER_NOT_FOUND');
});

test('16.7 AC2 — assignment: options endpoint, assign/unassign, invalid assignee 422, finalized 409', async ({
  request,
}) => {
  const assignees = await apiGet<Array<{ id: string; name: string; roleNameEn: string }>>(
    request,
    '/tenant/fnb-orders/assignees',
    fh.hotel.ownerToken,
  );
  expect(assignees.status).toBe(200);
  const options: Array<{ id: string; name: string; roleNameEn: string }> = Array.isArray(assignees.body)
    ? assignees.body
    : (assignees.body as unknown as { data: Array<{ id: string; name: string; roleNameEn: string }> }).data ?? [];
  const names = options.map((o) => o.roleNameEn);
  expect(names).toContain('Owner');
  expect(names).toContain('F&B / Kitchen');
  expect(names, 'front desk only reads the board').not.toContain('Front Desk');
  const kitchenOption = options.find((o) => o.roleNameEn === 'F&B / Kitchen')!;

  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const order = await placeOrderOk(request, guest.token, paidInput(tea.id));

  const assign = await apiPost(request, `/tenant/fnb-orders/${order.id}/assign`, {
    assigneeId: kitchenOption.id,
  }, fh.hotel.ownerToken);
  expect(assign.status, JSON.stringify(assign.body)).toBe(200);
  expect((assign.body as { assignedTo?: { id: string } }).assignedTo?.id).toBe(kitchenOption.id);

  const unassign = await apiPost(request, `/tenant/fnb-orders/${order.id}/assign`, {
    assigneeId: null,
  }, fh.hotel.ownerToken);
  expect(unassign.status).toBe(200);
  expect((unassign.body as { assignedTo?: { id: string } | null }).assignedTo).toBeNull();

  const invalid = await apiPost(request, `/tenant/fnb-orders/${order.id}/assign`, {
    assigneeId: '22222222-2222-4222-8222-222222222222',
  }, fh.hotel.ownerToken);
  expect(invalid.status).toBe(422);
  expect((invalid.body as { code?: string }).code).toBe('FNB_ASSIGNEE_INVALID');

  // Assignment is part of fnb_orders.update — a read-only board user can't.
  const forbidden = await apiPost(request, `/tenant/fnb-orders/${order.id}/assign`, {
    assigneeId: kitchenOption.id,
  }, frontDesk.token);
  expect(forbidden.status).toBe(403);

  await apiPost(request, `/tenant/fnb-orders/${order.id}/start`, {}, fh.hotel.ownerToken);
  await apiPost(request, `/tenant/fnb-orders/${order.id}/out-for-delivery`, {}, fh.hotel.ownerToken);
  await apiPost(request, `/tenant/fnb-orders/${order.id}/deliver`, {}, fh.hotel.ownerToken);
  const finalized = await apiPost(request, `/tenant/fnb-orders/${order.id}/assign`, {
    assigneeId: kitchenOption.id,
  }, fh.hotel.ownerToken);
  expect(finalized.status).toBe(409);
});

test('16.7 AC3 — filters, stats-lite and the server-side overdue filter', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const roomOrder = await placeOrderOk(request, guest.token, paidInput(tea.id, 4)); // 100 cash
  const lobbyOrder = await placeOrderOk(request, guest.token, {
    lines: [
      { itemId: cake.id, quantity: 1 },
      { itemId: tea.id, quantity: 1 },
    ],
    destination: { type: 'location', locationId: lobby.id },
    paymentMethod: 'cash',
  });

  const byDestination = await fnbBoard(request, fh.hotel.ownerToken, { destination: lobby.id });
  expect(byDestination.body.data.find((o) => o.id === lobbyOrder.id)).toBeTruthy();
  expect(byDestination.body.data.find((o) => o.id === roomOrder.id)).toBeUndefined();
  const byRoom = await fnbBoard(request, fh.hotel.ownerToken, { destination: 'room' });
  expect(byRoom.body.data.find((o) => o.id === roomOrder.id)).toBeTruthy();

  const byStatus = await fnbBoard(request, fh.hotel.ownerToken, { status: 'new' });
  const statuses = new Set(byStatus.body.data.map((o) => o.status));
  expect([...statuses].every((s) => s === 'new')).toBe(true);

  const byMenu = await fnbBoard(request, fh.hotel.ownerToken, { menuId });
  expect(byMenu.body.data.find((o) => o.id === roomOrder.id)).toBeTruthy();

  // Assignee filter (assign the lobby order to the kitchen user first).
  const assignees = await apiGet<Array<{ id: string; name: string; roleNameEn: string }>>(
    request,
    '/tenant/fnb-orders/assignees',
    fh.hotel.ownerToken,
  );
  const options = Array.isArray(assignees.body) ? assignees.body : [];
  const kitchenOption = options.find((o) => o.roleNameEn === 'F&B / Kitchen')!;
  await apiPost(request, `/tenant/fnb-orders/${lobbyOrder.id}/assign`, {
    assigneeId: kitchenOption.id,
  }, fh.hotel.ownerToken);
  const byAssignee = await fnbBoard(request, fh.hotel.ownerToken, { assigneeId: kitchenOption.id });
  expect(byAssignee.body.data.find((o) => o.id === lobbyOrder.id)).toBeTruthy();

  // Server-side overdue: shift the lobby order past its dueAt while open.
  sql(`UPDATE fnb_orders SET "dueAt" = NOW() - INTERVAL '2 hours' WHERE id = '${lobbyOrder.id}'`);
  const overdue = await fnbBoard(request, fh.hotel.ownerToken, { overdue: '1' });
  expect(overdue.body.data.find((o) => o.id === lobbyOrder.id), 'overdue filter is server-side for F&B').toBeTruthy();
  expect(overdue.body.data.find((o) => o.id === roomOrder.id)).toBeUndefined();

  // Revenue today: delivering a paid order moves its total into the stat.
  const before = (await fnbBoard(request, fh.hotel.ownerToken)).body.counts!;
  await apiPost(request, `/tenant/fnb-orders/${roomOrder.id}/start`, {}, fh.hotel.ownerToken);
  await apiPost(request, `/tenant/fnb-orders/${roomOrder.id}/out-for-delivery`, {}, fh.hotel.ownerToken);
  await apiPost(request, `/tenant/fnb-orders/${roomOrder.id}/deliver`, {}, fh.hotel.ownerToken);
  const after = (await fnbBoard(request, fh.hotel.ownerToken)).body.counts!;
  expect((after.revenueToday ?? 0) - (before.revenueToday ?? 0)).toBe(100);
  expect((after.deliveredToday ?? 0) - (before.deliveredToday ?? 0)).toBe(1);

  // History tab: server-side, finalized only, with the menu filter.
  const history = await fnbBoard(request, fh.hotel.ownerToken, { tab: 'history', menuId });
  expect(history.body.data.find((o) => o.id === roomOrder.id)).toBeTruthy();
  expect(history.body.data.find((o) => o.id === lobbyOrder.id)).toBeUndefined();
});

test('16.7 AC4 — lifecycle audits: created (guest-attributed), started, out, delivered, cancelled, assigned', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const order = await placeOrderOk(request, guest.token, paidInput(tea.id));

  const assignees = await apiGet<Array<{ id: string; name: string; roleNameEn: string }>>(
    request,
    '/tenant/fnb-orders/assignees',
    fh.hotel.ownerToken,
  );
  const kitchenOption = (Array.isArray(assignees.body) ? assignees.body : []).find(
    (o) => o.roleNameEn === 'F&B / Kitchen',
  )!;
  await apiPost(request, `/tenant/fnb-orders/${order.id}/assign`, { assigneeId: kitchenOption.id }, fh.hotel.ownerToken);
  await apiPost(request, `/tenant/fnb-orders/${order.id}/start`, {}, kitchen.token);
  await apiPost(request, `/tenant/fnb-orders/${order.id}/out-for-delivery`, {}, kitchen.token);
  await apiPost(request, `/tenant/fnb-orders/${order.id}/deliver`, {}, kitchen.token);

  expect(auditCount('fnb_order.created', order.id)).toBe(1);
  expect(auditCount('fnb_order.assigned', order.id)).toBe(1);
  expect(auditCount('fnb_order.started', order.id)).toBe(1);
  expect(auditCount('fnb_order.out_for_delivery', order.id)).toBe(1);
  expect(auditCount('fnb_order.delivered', order.id)).toBe(1);

  const createdMeta = JSON.parse(lastAuditMeta('fnb_order.created', order.id)!);
  expect(createdMeta.actorType).toBe('guest');
  expect(createdMeta.hotelId).toBe(fh.hotel.hotelId);

  const cancelTarget = await placeOrderOk(request, guest.token, paidInput(tea.id));
  await apiPost(request, `/tenant/fnb-orders/${cancelTarget.id}/cancel`, {
    reason: 'guest_request',
  }, kitchen.token);
  expect(auditCount('fnb_order.cancelled', cancelTarget.id)).toBe(1);
});

test('16.6 AC1/AC2 — guest tracking: transitions visible, delta-polled; delivered history with totals', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const before = await guestOrders(request, guest.token);
  const cursor = before.body.serverTime;

  const order = await placeOrderOk(request, guest.token, paidInput(tea.id, 2));
  await apiPost(request, `/tenant/fnb-orders/${order.id}/start`, {}, kitchen.token);

  const delta = await guestOrders(request, guest.token, cursor);
  expect(delta.status).toBe(200);
  const row = delta.body.data.find((o) => o.id === order.id);
  expect(row!.status).toBe('preparing');
  expect(row!.startedAt).toBeTruthy();

  await apiPost(request, `/tenant/fnb-orders/${order.id}/out-for-delivery`, {}, kitchen.token);
  await apiPost(request, `/tenant/fnb-orders/${order.id}/deliver`, {}, kitchen.token);

  const final = await guestOrders(request, guest.token);
  const delivered = final.body.data.find((o) => o.id === order.id)!;
  expect(delivered.status).toBe('delivered');
  expect(delivered.deliveredAt).toBeTruthy();
  expect(delivered.totalAmount).toBe(50);
  expect(delivered.paymentMethod).toBe('cash');
  expect(delivered.settled).toBe(false);
});

test('16.x — cross-tenant: foreign order/menu-item are 404s, never 403s', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const order = await placeOrderOk(request, guest.token, paidInput(tea.id));

  const foreignGet = await apiGet(request, `/tenant/fnb-orders/${order.id}`, other.hotel.ownerToken);
  expect(foreignGet.status).toBe(404);
  expect((foreignGet.body as { code?: string }).code).toBe('FNB_ORDER_NOT_FOUND');

  const foreignStart = await apiPost(request, `/tenant/fnb-orders/${order.id}/start`, {}, other.hotel.ownerToken);
  expect(foreignStart.status).toBe(404);

  const foreignItem = await apiPatch(request, `/tenant/fnb-menus/items/${tea.id}`, {
    price: 1,
  }, other.hotel.ownerToken);
  expect(foreignItem.status).toBe(404);
  expect((foreignItem.body as { code?: string }).code).toBe('FNB_ITEM_NOT_FOUND');
});

test('16.x — permission edges: front desk reads the board but cannot work orders; kitchen can', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const order = await placeOrderOk(request, guest.token, paidInput(tea.id));

  const read = await fnbBoard(request, frontDesk.token);
  expect(read.status).toBe(200);

  const denied = await apiPost(request, `/tenant/fnb-orders/${order.id}/start`, {}, frontDesk.token);
  expect(denied.status).toBe(403);

  const worked = await apiPost(request, `/tenant/fnb-orders/${order.id}/start`, {}, kitchen.token);
  expect(worked.status, JSON.stringify(worked.body)).toBe(200);
});
