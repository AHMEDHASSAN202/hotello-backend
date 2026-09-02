/**
 * Epic 15 — Story 15.1 Request Catalog (platform-translated, hotel-curated).
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  createFullModulePlan,
  apiPatch,
  apiPost,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestSessionOk } from '../../helpers/stays';
import { guestCatalog } from '../../helpers/requests';
import { lastAuditMetaByMeta } from '../../helpers/db';

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};
let roomSeq = 0;

test.beforeAll(async ({ request, adminToken }) => {
  const planId = await createFullModulePlan(request, adminToken, `QA Full ${Date.now().toString(36)}`);
  dedicated = await provisionHotel(request, { epic: 'e15', tag: `cat${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['901', '902', '903', '904', '905', '906', '907', '908', '909', '910'], 9);
  const { apiGetRetry } = await import('../../helpers/gxp-api');
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;
});

/**
 * Fresh ru guest session per test — guest JWTs live 15 minutes and long
 * full-suite runs cross that boundary; guests have no refresh token
 * (re-entry is by code).
 */
async function guest(req: Parameters<typeof checkInOk>[0]): Promise<string> {
  roomSeq += 1;
  const roomNumber = `9${String(roomSeq).padStart(2, '0')}`;
  const { stay, code } = await checkInOk(req, dedicated.ownerToken, {
    roomId: rooms[roomNumber],
    guestName: `Catalog Guest ${roomSeq}`,
    language: 'ru',
  });
  const session = await guestSessionOk(req, dedicated.slug, roomNumber, code);
  void stay;
  return session.accessToken;
}

test('15.1 AC1 — the seeded catalog reaches the guest fully translated (ru names)', async ({ request }) => {
  const token = await guest(request);
  const catalog = await guestCatalog(request, token);
  expect(catalog.categories.length).toBeGreaterThanOrEqual(4);
  const names = catalog.categories.map((c) => c.name);
  // Russian localization of the four starter categories (seed names).
  for (const expected of ['Уборка', 'Ремонт', 'Удобства', 'Ресепшен']) {
    expect(names, `category "${expected}" in ru`).toContain(expected);
  }
  // Extra towels item exists with its ru name and an SLA-backed quantity option.
  const hk = catalog.categories.find((c) => c.name === 'Уборка')!;
  const towels = hk.items.find((i) => /полотенц/i.test(i.name));
  expect(towels, 'extra towels item (ru)').toBeTruthy();
});

test('15.1 AC1 — the tenant catalog view shows EN/AR names, icons and SLA targets', async ({
  request,
}) => {
  const { findCatalogItem } = await import('../../helpers/requests');
  const towels = await findCatalogItem(request, dedicated.ownerToken, 'Extra towels');
  expect(towels).toBeTruthy();
  const res = await apiGet(request, '/tenant/request-catalog', dedicated.ownerToken);
  expect(res.status).toBe(200);
  const body = res.body as { categories: Array<{ names: { en: string; ar: string }; items: Array<{ names: { en: string; ar: string }; icon: string; slaMinutes: number; isCustom: boolean }> }> };
  const hk = body.categories.find((c) => c.names.en === 'Housekeeping')!;
  expect(hk.names.ar).toBeTruthy();
  const item = hk.items.find((i) => i.names.en === 'Extra towels')!;
  expect(item.icon).toBeTruthy();
  expect(item.slaMinutes).toBeGreaterThan(0);
  expect(item.isCustom).toBe(false);
});

test('15.1 AC2 — disabling an item hides it from guests; re-enabling restores it', async ({
  request,
}) => {
  const guestToken = await guest(request);
  const { findCatalogItem } = await import('../../helpers/requests');
  const pillows = await findCatalogItem(request, dedicated.ownerToken, 'Pillows & blanket');
  expect(pillows).toBeTruthy();

  const off = await apiPatch(request, `/tenant/request-catalog/items/${pillows!.itemId}`, {
    enabled: false,
  }, dedicated.ownerToken);
  expect(off.status).toBe(200);

  const guestView = await guestCatalog(request, guestToken);
  const hk = guestCatalogCategory(guestView, 'Уборка');
  expect(hk.items.find((i) => /подушк|одея/i.test(i.name))).toBeUndefined();

  const on = await apiPatch(request, `/tenant/request-catalog/items/${pillows!.itemId}`, {
    enabled: true,
  }, dedicated.ownerToken);
  expect(on.status).toBe(200);
  const restored = await guestCatalog(request, guestToken);
  expect(guestCatalogCategory(restored, 'Уборка').items.find((i) => /подушк|одея/i.test(i.name))).toBeTruthy();
});

test('15.1 AC2 — platform item translations are read-only (403 CUSTOM_ITEM_ONLY)', async ({
  request,
}) => {
  const { findCatalogItem } = await import('../../helpers/requests');
  const towels = await findCatalogItem(request, dedicated.ownerToken, 'Extra towels');
  const res = await apiPatch(request, `/tenant/request-catalog/items/${towels!.itemId}`, {
    nameEn: 'Towels (renamed by hotel)',
  }, dedicated.ownerToken);
  expect(res.status).toBe(403);
  expect((res.body as { code?: string }).code).toBe('CUSTOM_ITEM_ONLY');
});

test('15.1 AC2 — SLA target is adjustable per hotel', async ({ request }) => {
  const { findCatalogItem } = await import('../../helpers/requests');
  const iron = await findCatalogItem(request, dedicated.ownerToken, 'Iron & ironing board');
  const res = await apiPatch(request, `/tenant/request-catalog/items/${iron!.itemId}`, {
    slaMinutes: 20,
  }, dedicated.ownerToken);
  expect(res.status).toBe(200);
  const view = await apiGet<{ categories: Array<{ items: Array<{ id: string; slaMinutes: number }> }> }>(
    request,
    '/tenant/request-catalog',
    dedicated.ownerToken,
  );
  const item = view.body.categories.flatMap((c) => c.items).find((i) => i.id === iron!.itemId);
  expect(item?.slaMinutes).toBe(20);
});

test('15.1 AC3 — items expose their option config (quantity range / wake-up time)', async ({
  request,
}) => {
  const catalog = await guestCatalog(request, await guest(request));
  const wakeUp = catalog.categories
    .flatMap((c) => c.items)
    .find((i) => i.optionType === 'time');
  expect(wakeUp, 'wake-up call has the time option').toBeTruthy();

  const { findCatalogItem } = await import('../../helpers/requests');
  const towelsTenant = await findCatalogItem(request, dedicated.ownerToken, 'Extra towels');
  const view = await apiGet<{ categories: Array<{ items: Array<{ id: string; optionType: string | null; optionMin: number | null; optionMax: number | null }> }> }>(
    request,
    '/tenant/request-catalog',
    dedicated.ownerToken,
  );
  const towels = view.body.categories.flatMap((c) => c.items).find((i) => i.id === towelsTenant!.itemId);
  expect(towels?.optionType).toBe('quantity');
  expect(towels?.optionMin).toBe(1);
  expect(towels?.optionMax).toBeGreaterThanOrEqual(2);
});

test('15.1 AC4 — custom items: AR+EN required; ru guests fall back to EN', async ({
  request,
}) => {
  const guestToken = await guest(request);
  const { findCatalogCategory } = await import('../../helpers/requests');
  const hkCategory = await findCatalogCategory(request, dedicated.ownerToken, 'Housekeeping');
  expect(hkCategory, 'housekeeping category').toBeTruthy();

  const missingAr = await apiPost(request, '/tenant/request-catalog/items', {
    categoryId: hkCategory!,
    nameEn: 'Qa Custom Item',
    slaMinutes: 15,
  }, dedicated.ownerToken);
  expect(missingAr.status).toBe(400);

  const created = await apiPost<{ id: string; isCustom?: boolean; code?: string }>(
    request,
    '/tenant/request-catalog/items',
    {
      categoryId: hkCategory!,
      nameEn: 'Qa Custom Item',
      nameAr: 'طلب خاص تجريبي',
      slaMinutes: 15,
    },
    dedicated.ownerToken,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  const catalog = await guestCatalog(request, guestToken);
  const custom = catalog.categories
    .flatMap((c) => c.items)
    .find((i) => i.name === 'Qa Custom Item');
  expect(custom, 'ru guest sees the EN fallback for the custom item').toBeTruthy();
});

test('15.1 AC6 — catalog mutations are audited with diffs', async ({ request }) => {
  // Self-contained mutation (entityId is the item id — the hotel id rides in
  // the metadata; within-file tests may run in separate workers).
  const { findCatalogItem } = await import('../../helpers/requests');
  const toiletries = await findCatalogItem(request, dedicated.ownerToken, 'Toiletries');
  expect(toiletries).toBeTruthy();
  const mutation = await apiPatch(request, `/tenant/request-catalog/items/${toiletries!.itemId}`, {
    slaMinutes: 25,
  }, dedicated.ownerToken);
  expect(mutation.status).toBe(200);

  const { lastAuditMetaByMeta } = await import('../../helpers/db');
  const meta = lastAuditMetaByMeta('request_catalog.updated', dedicated.hotelId);
  expect(meta, 'request_catalog.updated audit exists').toBeTruthy();
  expect(JSON.parse(meta!).diff).toBeTruthy();
});

function guestCatalogCategory(catalog: { categories: Array<{ name: string; items: Array<{ name: string }> }> }, name: string) {
  const category = catalog.categories.find((c) => c.name === name);
  expect(category, `category ${name}`).toBeTruthy();
  return category!;
}
