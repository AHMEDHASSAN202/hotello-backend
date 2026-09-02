/**
 * Epic 15 — Stories 15.4 board + 15.5 lifecycle/assignment + 15.6 SLA (API).
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  createFullModulePlan,
  apiPost,
  createRoomsQuickly,
  createStaffUser,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestSessionOk, guestName } from '../../helpers/stays';
import { board, findCatalogItem, guestCancel, guestCatalog, submitOk } from '../../helpers/requests';
import { auditCount, lastAuditMeta, sql } from '../../helpers/db';

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};
let guestToken = '';
let staff: { token: string; id?: string };

test.beforeAll(async ({ request, adminToken }) => {
  const planId = await createFullModulePlan(request, adminToken, `QA Full ${Date.now().toString(36)}`);
  dedicated = await provisionHotel(request, { epic: 'e15', tag: `bd${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['921', '922', '923', '924'], 9);
  const { apiGetRetry } = await import('../../helpers/gxp-api');
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;

  staff = await createStaffUser(request, dedicated.ownerToken, dedicated.slug, [
    'stays.read',
    'requests.read',
    'requests.update',
    'requests.assign',
  ]);

  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms['921'],
    guestName: 'Board Guest',
    language: 'en',
  });
  const session = await guestSessionOk(request, dedicated.slug, '921', code);
  guestToken = session.accessToken;
  void stay;
});

async function itemId(req: Parameters<typeof apiGet>[0], nameEn: string): Promise<string> {
  return (await findCatalogItem(req, dedicated.ownerToken, nameEn))!.itemId;
}

test('15.2 AC4/15.4 AC1 — a guest request lands on the board with room + guest + status', async ({ request }) => {
  const towels = await itemId(request, 'Extra towels');
  const created = await submitOk(request, guestToken, towels, { note: 'Two please' });

  const open = await board(request, dedicated.ownerToken);
  expect(open.status).toBe(200);
  const row = open.body.data.find((r) => r.id === created.id);
  expect(row).toBeTruthy();
  expect(row!.roomNumber).toBe('921');
  expect(row!.status).toBe('new');
  expect(String(JSON.stringify(row))).toContain('Board Guest');
});

test('15.5 AC1 — transitions: start auto-assigns, complete finishes; final states', async ({ request }) => {
  const item = await itemId(request, 'Extra towels');
  const created = await submitOk(request, guestToken, item);

  const start = await apiPost(request, `/tenant/requests/${created.id}/start`, {}, dedicated.ownerToken);
  expect(start.status).toBe(200);
  const started = start.body as { status: string; assignedTo?: { id: string } | null };
  expect(started.status).toBe('in_progress');
  // Auto-assigned to the actor (the owner here).
  expect(started.assignedTo).toBeTruthy();

  // Guest cancel must now be refused (work started).
  const guestCancel = await apiPost(request, `/guest/requests/${created.id}/cancel`, {}, guestToken);
  expect([403, 409]).toContain(guestCancel.status);

  const complete = await apiPost(request, `/tenant/requests/${created.id}/complete`, {}, dedicated.ownerToken);
  expect(complete.status).toBe(200);
  expect((complete.body as { status: string }).status).toBe('done');

  // Final: no further transitions.
  const restart = await apiPost(request, `/tenant/requests/${created.id}/start`, {}, dedicated.ownerToken);
  expect(restart.status).toBe(409);
  const completeAgain = await apiPost(request, `/tenant/requests/${created.id}/complete`, {}, dedicated.ownerToken);
  expect(completeAgain.status).toBe(409);
});

test('15.5 AC1 — staff cancel requires a reason; `other` requires a note', async ({ request }) => {
  const item = await itemId(request, 'Extra towels');
  const created = await submitOk(request, guestToken, item);

  const noReason = await apiPost(request, `/tenant/requests/${created.id}/cancel`, {}, dedicated.ownerToken);
  expect(noReason.status).toBe(400);

  const otherNoNote = await apiPost(request, `/tenant/requests/${created.id}/cancel`, {
    reason: 'other',
  }, dedicated.ownerToken);
  expect(otherNoNote.status).toBe(400);

  const cancelled = await apiPost(request, `/tenant/requests/${created.id}/cancel`, {
    reason: 'other',
    note: 'Item out of stock',
  }, dedicated.ownerToken);
  expect(cancelled.status).toBe(200);
  expect((cancelled.body as { cancelledReason?: string }).cancelledReason).toBe('other');
});

test('15.5 AC2 — assignment: options endpoint, assign/reassign, permission edge', async ({ request }) => {
  const item = await itemId(request, 'Extra towels');
  const created = await submitOk(request, guestToken, item);

  const assignees = await apiGet<Array<{ id: string; name: string }> | { data: Array<{ id: string; name: string }> }>(
    request,
    '/tenant/requests/assignees',
    dedicated.ownerToken,
  );
  const options = Array.isArray(assignees.body) ? assignees.body : (assignees.body as { data: Array<{ id: string; name: string }> }).data ?? [];
  expect(options.length, JSON.stringify(assignees.body)).toBeGreaterThan(0);
  const assignee = options[0]!;

  const assign = await apiPost(request, `/tenant/requests/${created.id}/assign`, {
    assigneeId: assignee.id,
  }, dedicated.ownerToken);
  expect(assign.status).toBe(200);
  expect((assign.body as { assignedTo?: { id: string } }).assignedTo?.id).toBe(assignee.id);

  // A user WITHOUT requests.assign cannot assign.
  const updater = await createStaffUser(request, dedicated.ownerToken, dedicated.slug, [
    'stays.read',
    'requests.read',
    'requests.update',
  ]);
  const forbidden = await apiPost(request, `/tenant/requests/${created.id}/assign`, {
    assigneeId: assignee.id,
  }, updater.token);
  expect(forbidden.status).toBe(403);

  // Assignee filter on the board — assert on THIS test's request (other
  // concurrent tests mutate the same hotel's board).
  const filtered = await board(request, dedicated.ownerToken, { assigneeId: assignee.id });
  const mine = filtered.body.data.find((r) => r.id === created.id);
  expect(mine, 'assigned request visible under the assignee filter').toBeTruthy();
  expect((mine!.assignedTo as { id: string } | null)?.id).toBe(assignee.id);
});

test('15.5 AC4 — lifecycle audits with actors', async ({ request }) => {
  const item = await itemId(request, 'Extra towels');
  const created = await submitOk(request, guestToken, item);

  await apiPost(request, `/tenant/requests/${created.id}/start`, {}, dedicated.ownerToken);
  await apiPost(request, `/tenant/requests/${created.id}/complete`, {}, dedicated.ownerToken);

  expect(auditCount('request.created', created.id)).toBe(1);
  expect(auditCount('request.started', created.id)).toBe(1);
  expect(auditCount('request.completed', created.id)).toBe(1);
  // The created audit is guest-attributed (actor null).
  const meta = JSON.parse(lastAuditMeta('request.created', created.id)!);
  expect(meta.actorType).toBe('guest');
});

test('15.4 AC2 — board filters: open tab is client-side; history filters are server-side', async ({
  request,
}) => {
  const towels = await itemId(request, 'Extra towels');
  const wakeUp = await itemId(request, 'Wake-up call');
  const a = await submitOk(request, guestToken, towels, { optionValue: '1' });
  const b = await submitOk(request, guestToken, wakeUp, { optionValue: '07:00' });

  // OPEN tab: the API returns all open requests (newest first); the tenant
  // UI applies category/assignee/floor filters CLIENT-side on this payload.
  const open = await board(request, dedicated.ownerToken);
  const ids = open.body.data.map((r) => r.id);
  // Newest first (createdAt DESC): b was submitted after a. The overdue
  // float is client-side (board-core); the API orders by createdAt.
  expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));

  // Overdue accounting: shift b past its due date while still OPEN.
  sql(`UPDATE requests SET "createdAt" = NOW() - INTERVAL '3 hours', "dueAt" = NOW() - INTERVAL '2 hours' WHERE id = '${b.id}'`);
  const afterShift = await board(request, dedicated.ownerToken);
  expect(afterShift.body.counts?.overdueNow ?? 0).toBeGreaterThanOrEqual(1);

  // HISTORY tab: server-side category filter (the department lens).
  await guestCancel(request, guestToken, a.id);
  await guestCancel(request, guestToken, b.id);
  const hk = await findCatalogItem(request, dedicated.ownerToken, 'Extra towels');
  const byCategory = await board(request, dedicated.ownerToken, {
    tab: 'history',
    categoryId: hk!.categoryId,
  });
  const categoryIds = byCategory.body.data.map((r) => r.id);
  expect(categoryIds).toContain(a.id);
  expect(categoryIds).not.toContain(b.id);

  // Floor filter (server-side, history): rooms 92x sit on floor 9.
  const byFloor = await board(request, dedicated.ownerToken, {
    tab: 'history',
    floor: 9,
  });
  expect(byFloor.body.data.map((r) => r.id)).toContain(a.id);

});

test('15.4 AC3/15.6 AC3 — delta polling: updatedSince returns changed rows + counts + cursor', async ({
  request,
}) => {
  const before = await board(request, dedicated.ownerToken);
  const cursor = before.body.serverTime!;

  const item = await itemId(request, 'Extra towels');
  const created = await submitOk(request, guestToken, item);

  const delta = await board(request, dedicated.ownerToken, { updatedSince: cursor });
  expect(delta.status).toBe(200);
  expect(delta.body.data.map((r) => r.id)).toContain(created.id);
  expect(delta.body.counts).toMatchObject({
    open: expect.any(Number),
    doneToday: expect.any(Number),
    overdueNow: expect.any(Number),
  });
  expect(delta.body.serverTime).toBeTruthy();
});

test('15.6 AC1/AC2 — SLA snapshot at submission; cancelled requests exit SLA', async ({
  request,
}) => {
  const towels = await itemId(request, 'Extra towels');
  const created = await submitOk(request, guestToken, towels, { optionValue: '1' });

  const detail = await apiGet<{ slaTargetMinutes?: number; dueAt?: string | null }>(
    request,
    `/tenant/requests/${created.id}`,
    dedicated.ownerToken,
  );
  expect(detail.status).toBe(200);
  expect(detail.body.slaTargetMinutes).toBeGreaterThan(0);
  expect(detail.body.dueAt).toBeTruthy();

  // Push it past its due date while still open → counted overdue.
  sql(`UPDATE requests SET "createdAt" = NOW() - INTERVAL '3 hours', "dueAt" = NOW() - INTERVAL '2 hours' WHERE id = '${created.id}'`);
  const before = await board(request, dedicated.ownerToken);
  expect(before.body.counts?.overdueNow ?? 0).toBeGreaterThanOrEqual(1);

  // Cancel (guest token — the guest endpoint sets the reason itself).
  const guestCancel = await apiPost(request, `/guest/requests/${created.id}/cancel`, {}, guestToken);
  expect(guestCancel.status, JSON.stringify(guestCancel.body)).toBe(200);

  // Cancelled exits SLA: the overdue count drops back down.
  const after = await board(request, dedicated.ownerToken);
  expect(after.body.counts?.overdueNow ?? 0).toBe(0);
});

test('15.x — module gating: a plan without `requests` locks both surfaces', async ({
  request,
  adminToken,
}) => {
  const { createPlan } = await import('../../helpers/gxp-api');
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA NoRequests ${Date.now().toString(36)}`,
    enabledModules: ['housekeeping', 'hotel_info', 'fnb'],
  });
  const hotel = await provisionHotel(request, { epic: 'e15', tag: `ng${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['950'], 9);
  const list = await apiGet<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200&search=950',
    hotel.ownerToken,
  );
  const { stay, code } = await checkInOk(request, hotel.ownerToken, {
    roomId: list.body.data[0]!.id,
    guestName: guestName(),
  });
  const session = await guestSessionOk(request, hotel.slug, '950', code);

  // Guest catalog → 403 MODULE_NOT_ENABLED.
  const catalog = await apiGet(request, '/guest/catalog', session.accessToken);
  expect(catalog.status).toBe(403);
  expect((catalog.body as { code?: string }).code).toBe('MODULE_NOT_ENABLED');

  // Tenant board → 403 as well.
  const tenantBoard = await apiGet(request, '/tenant/requests', hotel.ownerToken);
  expect(tenantBoard.status).toBe(403);
  expect((tenantBoard.body as { code?: string }).code).toBe('MODULE_NOT_ENABLED');
  void stay;
});

test('15.x — requests.read-less staff cannot see the board', async ({ request }) => {
  const noBoard = await createStaffUser(request, dedicated.ownerToken, dedicated.slug, [
    'stays.read',
  ]);
  const res = await board(request, noBoard.token);
  expect(res.status).toBe(403);
});
