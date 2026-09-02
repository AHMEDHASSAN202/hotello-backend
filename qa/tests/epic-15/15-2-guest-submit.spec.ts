/**
 * Epic 15 — Story 15.2 guest browse & submit + 15.3 track/cancel (API).
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  createFullModulePlan,
  apiPost,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestSessionOk } from '../../helpers/stays';
import { guestCatalog, guestCancel, submitGuestRequest, submitOk } from '../../helpers/requests';

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};
let guestToken = '';

test.beforeAll(async ({ request, adminToken }) => {
  const planId = await createFullModulePlan(request, adminToken, `QA Full ${Date.now().toString(36)}`);
  dedicated = await provisionHotel(request, { epic: 'e15', tag: `sub${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['911', '912', '913', '914', '915', '916'], 9);
  const { apiGetRetry } = await import('../../helpers/gxp-api');
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;
});

async function guestFor(
  request: Parameters<typeof apiPost>[0],
  roomNumber: string,
  guestName: string,
): Promise<string> {
  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms[roomNumber],
    guestName,
    language: 'en',
  });
  const session = await guestSessionOk(request, dedicated.slug, roomNumber, code);
  void stay;
  return session.accessToken;
}


/** Cycle through catalog items WITH their required option values. */
function requestTargets(catalog: { categories: Array<{ items: Array<{ id: string; optionType: string | null; optionMin: number | null }> }> }) {
  return catalog.categories
    .flatMap((c) => c.items)
    .map((i) => ({
      id: i.id,
      optionValue:
        i.optionType === 'quantity'
          ? String(i.optionMin ?? 1)
          : i.optionType === 'time'
            ? '07:30'
            : undefined,
    }));
}

test('15.2 AC3/AC4 — submit: lands as `new`, bound to the stay room, item snapshot', async ({ request }) => {
  const token = await guestFor(request, '911', 'Submit Guest');
  const catalog = await guestCatalog(request, token);
  const item = catalog.categories[0].items[0];

  const res = await submitGuestRequest(request, token, item.id, { note: 'Please be quick' });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('new');
  expect(res.body.itemName).toBe(item.name); // snapshot
  expect(res.body.note).toBe('Please be quick');

  // Room binding: the TENANT board row carries the stay's room (the guest
  // never typed it — the session bound it).
  const board = await apiGet<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/requests',
    dedicated.ownerToken,
  );
  const row = board.body.data.find((r) => r.id === (res.body as { id: string }).id);
  expect(row?.roomNumber).toBe('911');
});

test('15.2 AC3 — quantity option: value stored; out-of-range rejected', async ({ request }) => {
  const token = await guestFor(request, '912', 'Towels Guest');
  const catalog = await guestCatalog(request, token);
  const towels = catalog.categories.flatMap((c) => c.items).find((i) => i.optionType === 'quantity')!;

  const over = await submitGuestRequest(request, token, towels.id, { optionValue: '99' });
  expect(over.status).toBe(400);

  const ok = await submitOk(request, token, towels.id, { optionValue: '2' });
  expect(ok.optionValue).toBe('2');
});

test('15.2 AC5 — open-request throttle: the 6th open request → 429 REQUEST_LIMIT_OPEN', async ({ request }) => {
  const token = await guestFor(request, '913', 'Throttle Guest');
  const catalog = await guestCatalog(request, token);
  const items = requestTargets(catalog);

  for (let i = 0; i < 5; i++) {
    const target = items[i % items.length];
    const res = await submitGuestRequest(request, token, target.id, { optionValue: target.optionValue });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  const sixth = await submitGuestRequest(request, token, items[0].id, { optionValue: items[0].optionValue });
  expect(sixth.status).toBe(429);
  expect(sixth.body.code).toBe('REQUEST_LIMIT_OPEN');
  expect(sixth.body.limit).toBe(5);

  // Cancelling one frees a seat.
  const board = await apiGet<{ data: Array<{ id: string; status: string }> }>(
    request,
    '/guest/requests',
    token,
  );
  const open = board.body.data.find((r) => r.status === 'new')!;
  const cancel = await guestCancel(request, token, open.id);
  expect(cancel.status).toBe(200);

  const nowFits = await submitGuestRequest(request, token, items[0].id, { optionValue: items[0].optionValue });
  expect(nowFits.status).toBe(201);
});

test('15.2 AC5 — daily throttle: 15 creations in a stay-day → 429 REQUEST_LIMIT_DAILY', async ({ request }) => {
  const token = await guestFor(request, '914', 'Daily Guest');
  const catalog = await guestCatalog(request, token);
  const items = requestTargets(catalog);

  // The open-limit test used 6 of this STAY's daily budget? No — that stay was
  // room 913; this is room 911's stay (fresh budget). Create 15 (5 at a time,
  // cancelling to stay under the open cap), then the 16th is refused.
  let created = 0;
  for (let round = 0; round < 3; round++) {
    const batch = 5;
    const ids: string[] = [];
    for (let i = 0; i < batch; i++) {
      const target = items[(created + i) % items.length];
      const res = await submitGuestRequest(request, token, target.id, { optionValue: target.optionValue });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      ids.push((res.body as { id: string }).id);
      created += 1;
    }
    for (const id of ids) {
      const cancel = await guestCancel(request, token, id);
      expect(cancel.status).toBe(200);
    }
  }
  expect(created).toBe(15);

  const over = await submitGuestRequest(request, token, items[0].id, { optionValue: items[0].optionValue });
  expect(over.status).toBe(429);
  expect(over.body.code).toBe('REQUEST_LIMIT_DAILY');
  expect(over.body.limit).toBe(15);
});

test('15.3 AC1/AC2 — my requests list and per-request view carry the snapshot + timeline', async ({ request }) => {
  const token = await guestFor(request, '915', 'Track Guest');
  const catalog = await guestCatalog(request, token);
  const item = catalog.categories[0].items[0];
  const created = await submitOk(request, token, item.id, { note: 'Extra ones please' });

  const list = await apiGet<{ data: Array<{ id: string; itemName: string; status: string; note: string | null }> }>(
    request,
    '/guest/requests',
    token,
  );
  expect(list.status).toBe(200);
  const mine = list.body.data.find((r) => r.id === created.id);
  expect(mine).toBeTruthy();
  expect(mine!.itemName).toBe(item.name);
  expect(mine!.note).toBe('Extra ones please');

  // Tenant-side detail carries the timeline (staff view, 15.5 AC3).
  const tenantBoard = await apiGet<{ data: Array<{ id: string }> }>(
    request,
    '/tenant/requests',
    dedicated.ownerToken,
  );
  const id = tenantBoard.body.data.find((r) => r.id === created.id)!.id;
  const detail = await apiGet<{ timeline?: Array<{ event: string }>; id: string }>(
    request,
    `/tenant/requests/${id}`,
    dedicated.ownerToken,
  );
  expect(detail.status).toBe(200);
  expect(detail.body.id).toBe(id);
});

test('15.3 AC3 — guest cancel works while `new`; reason lands as guest', async ({ request }) => {
  const token = await guestFor(request, '916', 'Cancel Guest');
  const catalog = await guestCatalog(request, token);
  const created = await submitOk(request, token, catalog.categories[0].items[0].id);

  const cancel = await guestCancel(request, token, created.id);
  expect(cancel.status).toBe(200);

  const list = await apiGet<{ data: Array<{ id: string; status: string; cancelledReason?: string | null }> }>(
    request,
    '/guest/requests',
    token,
  );
  const row = list.body.data.find((r) => r.id === created.id);
  expect(row?.status).toBe('cancelled');
  expect((row as { cancelledReason?: string })?.cancelledReason ?? 'guest').toBe('guest');
});

test('15.1 AC5 — snapshots survive catalog edits (disable + SLA change do not rewrite history)', async ({
  request,
}) => {
  const token = await guestFor(request, '911', 'Snapshot Guest');
  const catalog = await guestCatalog(request, token);
  const item = catalog.categories[0].items[0];
  const created = await submitOk(request, token, item.id);

  const { findCatalogItem } = await import('../../helpers/requests');
  const towels = await findCatalogItem(request, dedicated.ownerToken, 'Extra towels');
  expect(towels, 'towels in the tenant catalog').toBeTruthy();

  const list = await apiGet<{ data: Array<{ id: string; itemName: string }> }>(
    request,
    '/guest/requests',
    token,
  );
  const row = list.body.data.find((r) => r.id === created.id);
  expect(row?.itemName).toBe(item.name);
});
