/**
 * Epic 16 — Story 16.2 menus & items management (tree, windows, pricing
 * modes, variants, notes, photos, snapshot rule, audits) + module/permission
 * gating for the menus surface.
 */
import { expect, test } from '../../fixtures';
import { apiGet, apiGetRaw, apiPatch, apiPostForm } from '../../helpers/gxp-api';
import { lastAuditMetaByMeta } from '../../helpers/db';
import {
  createItemOk,
  createMenuOk,
  createSectionOk,
  createStaffWithRole,
  guestMenus,
  newGuest,
  openWindow,
  provisionFnbHotel,
  TINY_PNG,
  type FnbHotel,
  type GuestFnbCatalogView,
} from './helpers';

let fh: FnbHotel;

test.beforeAll(async ({ request, adminToken }) => {
  fh = await provisionFnbHotel(request, adminToken, `menu${Date.now().toString(36)}`, ['711', '712', '713', '714', '715', '716', '717', '718', '719', '720', '721']);
});

test('16.2 AC1 — menus: AR+EN required, seven-language names, windows + prep SLA stored', async ({
  request,
}) => {
  const missingAr = await apiPost16(request, '/tenant/fnb-menus', { nameEn: 'Breakfast' });
  expect(missingAr.status).toBe(400);

  const badSla = await apiPost16(request, '/tenant/fnb-menus', {
    nameEn: 'Breakfast',
    nameAr: 'فطور',
    prepSlaMinutes: 3,
  });
  expect(badSla.status).toBe(400);

  const badWindow = await apiPost16(request, '/tenant/fnb-menus', {
    nameEn: 'Breakfast',
    nameAr: 'فطور',
    windows: [{ start: '7am', end: '11:00' }],
  });
  expect(badWindow.status).toBe(400);

  const menu = await createMenuOk(request, fh.hotel.ownerToken, {
    nameEn: 'In-Room Dining',
    nameAr: 'خدمة الوجبات',
    nameRu: 'Номер-сервис',
    nameDe: 'Zimmerservice',
    descriptionEn: 'Served around the clock',
    descriptionAr: 'خدمة على مدار الساعة',
    windows: [openWindow(), { start: '20:00', end: '02:00' }],
    prepSlaMinutes: 25,
  });
  expect(menu.names.en).toBe('In-Room Dining');
  expect(menu.names.ru).toBe('Номер-сервис');
  expect(menu.prepSlaMinutes).toBe(25);
  expect(menu.windows).toHaveLength(2);
  expect(menu.defaultIncludedFor).toEqual([]); // menu default: everything paid
  expect(menu.isActive).toBe(true);

  const tree = await apiGet<{ menus: Array<{ id: string; names: Record<string, string>; windows: unknown[] }> }>(
    request,
    '/tenant/fnb-menus',
    fh.hotel.ownerToken,
  );
  expect(tree.status).toBe(200);
  expect(tree.body.menus.find((m) => m.id === menu.id)?.names.de).toBe('Zimmerservice');
});

test('16.2 AC1 — overnight availability windows (20:00–02:00) are honored hotel-local', async ({
  request,
}) => {
  const menu = await createMenuOk(request, fh.hotel.ownerToken, {
    nameEn: 'Late Night',
    nameAr: 'وجبة ليلية',
    windows: [{ start: '20:00', end: '02:00' }],
    prepSlaMinutes: 20,
  });
  const section = await createSectionOk(request, fh.hotel.ownerToken, menu.id, {
    nameEn: 'Midnight',
    nameAr: 'منتصف الليل',
  });
  await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'Club Sandwich',
    nameAr: 'ساندويتش كلوب',
    price: 90,
  });

  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const catalog = await guestMenus(request, guest.token);
  const late = catalog.menus.find((m) => m.id === menu.id);
  expect(late, 'closed-window menu still browsable').toBeTruthy();

  // Independent recomputation of the server rule (start-inclusive,
  // end-exclusive, start > end spans midnight) — hotel tz is UTC.
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const expectedAvailable = minutes >= 20 * 60 || minutes < 2 * 60;
  expect(late!.availability.available).toBe(expectedAvailable);
  if (!expectedAvailable) {
    expect(late!.availability.opensAt).toBe('20:00');
  }

  // The server is the ordering authority regardless of what a client rendered.
  const item = late!.sections[0].items[0];
  const order = await import('./helpers').then((h) =>
    h.placeOrder(request, guest.token, {
      lines: [{ itemId: item.id, quantity: 1 }],
      destination: { type: 'room' },
      paymentMethod: 'cash',
    }),
  );
  if (expectedAvailable) {
    expect(order.status, JSON.stringify(order.body)).toBe(201);
  } else {
    expect(order.status).toBe(409);
    expect(order.body.code).toBe('MENU_UNAVAILABLE');
    expect(order.body.menuId).toBe(menu.id);
  }
});

test('16.2 AC2 — sections + items: bilingual section names required, item price validated', async ({
  request,
}) => {
  const menu = await createMenuOk(request, fh.hotel.ownerToken, {
    nameEn: 'Pool Bar',
    nameAr: 'بار المسبح',
  });
  const missingAr = await apiPost16(request, `/tenant/fnb-menus/${menu.id}/sections`, {
    nameEn: 'Drinks',
  });
  expect(missingAr.status).toBe(400);

  const section = await createSectionOk(request, fh.hotel.ownerToken, menu.id, {
    nameEn: 'Drinks',
    nameAr: 'مشروبات',
    sortOrder: 1,
  });
  expect(section.names.ar).toBe('مشروبات');

  const badPrice = await apiPost16(request, `/tenant/fnb-menus/sections/${section.id}/items`, {
    nameEn: 'Lemonade',
    nameAr: 'ليموناضة',
    price: -5,
  });
  expect(badPrice.status).toBe(400);

  const item = await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'Lemonade',
    nameAr: 'ليموناضة',
    descriptionEn: 'Fresh squeezed',
    price: 35,
    sortOrder: 2,
  });
  expect(item.price).toBe(35);
  expect(item.includedFor).toBeNull(); // inherit the menu default
  expect(item.allowNotes).toBe(true); // free note by default (AC5)
  expect(item.isActive).toBe(true);
});

test('16.2 AC2 — item photo: upload → two renditions served; bad file 400; delete clears', async ({
  request,
}) => {
  const menu = await createMenuOk(request, fh.hotel.ownerToken, { nameEn: 'Photo Menu', nameAr: 'قائمة بالصور' });
  const section = await createSectionOk(request, fh.hotel.ownerToken, menu.id, { nameEn: 'Mains', nameAr: 'الأطباق' });
  const item = await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'Burger',
    nameAr: 'برجر',
    price: 120,
  });

  const bad = await apiPostForm(
    request,
    `/tenant/fnb-menus/items/${item.id}/photo`,
    { multipart: { file: { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') } } },
    fh.hotel.ownerToken,
  );
  expect(bad.status).toBe(400);
  expect(bad.body.code).toBe('FNB_PHOTO_INVALID');

  const uploaded = await apiPostForm(
    request,
    `/tenant/fnb-menus/items/${item.id}/photo`,
    { multipart: { file: { name: 'burger.png', mimeType: 'image/png', buffer: TINY_PNG } } },
    fh.hotel.ownerToken,
  );
  expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
  const view = uploaded.body as unknown as { photoThumbUrl: string; photoDetailUrl: string };
  expect(view.photoThumbUrl).toContain('files/fnb/');
  expect(view.photoDetailUrl).toContain('files/fnb/');
  expect(view.photoThumbUrl).not.toBe(view.photoDetailUrl);

  const thumb = await apiGetRaw(request, `/${view.photoThumbUrl}`);
  expect(thumb.status).toBe(200);
  expect(thumb.contentType).toBe('image/webp');
  expect(thumb.headers['cache-control']).toContain('immutable');

  const removed = await apiDelete16(request, `/tenant/fnb-menus/items/${item.id}/photo`);
  expect(removed.status).toBe(200);
  const after = await menuTree(request);
  const cleared = after.menus.flatMap((m) => m.sections).flatMap((s) => s.items).find((i) => i.id === item.id);
  expect(cleared?.photoThumbUrl ?? null).toBeNull();
});

test('16.2 AC3 — pricing mode: menu-level included-for-AI default, per-item always-paid override', async ({
  request,
}) => {
  const menu = await createMenuOk(request, fh.hotel.ownerToken, {
    nameEn: 'AI Resort Menu',
    nameAr: 'قائمة المنتجع',
    defaultIncludedFor: ['all_inclusive'],
  });
  const section = await createSectionOk(request, fh.hotel.ownerToken, menu.id, { nameEn: 'Bar', nameAr: 'البار' });
  // Inherits the menu default (includedFor: null)…
  const juice = await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'Fresh Juice',
    nameAr: 'عصير طازج',
    price: 60,
  });
  // …and the override: imported whiskey stays paid for EVERY stay type.
  const whiskey = await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'Imported Whiskey',
    nameAr: 'ويسكي مستورد',
    price: 220,
    includedFor: [],
  });

  const ai = await newGuest(request, fh, { stayType: 'all_inclusive' });
  const aiCatalog = await guestMenus(request, ai.token);
  const aiMenu = aiCatalog.menus.find((m) => m.id === menu.id)!;
  const aiJuice = aiMenu.sections[0].items.find((i) => i.id === juice.id)!;
  const aiWhiskey = aiMenu.sections[0].items.find((i) => i.id === whiskey.id)!;
  expect(aiJuice.included).toBe(true);
  expect(aiJuice.unitPrice).toBe(0);
  expect(aiWhiskey.included).toBe(false);
  expect(aiWhiskey.unitPrice).toBe(220);

  const ro = await newGuest(request, fh, { stayType: 'room_only' });
  const roCatalog = await guestMenus(request, ro.token);
  const roMenu = roCatalog.menus.find((m) => m.id === menu.id)!;
  const roJuice = roMenu.sections[0].items.find((i) => i.id === juice.id)!;
  expect(roJuice.included).toBe(false);
  expect(roJuice.unitPrice).toBe(60);
});

test('16.2 AC3 — pricing matrix: explicit includedFor subset across all four stay types', async ({
  request,
}) => {
  const menu = await createMenuOk(request, fh.hotel.ownerToken, { nameEn: 'Matrix Menu', nameAr: 'قائمة المصفوفة' });
  const section = await createSectionOk(request, fh.hotel.ownerToken, menu.id, { nameEn: 'S', nameAr: 'ق' });
  const halfBoardOnly = await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'HB Special',
    nameAr: 'طبق نصف الإقامة',
    price: 75,
    includedFor: ['half_board'],
  });

  const expectations: Array<[string, boolean, number]> = [
    ['all_inclusive', false, 75],
    ['half_board', true, 0],
    ['bed_breakfast', false, 75],
    ['room_only', false, 75],
  ];
  for (const [stayType, included, price] of expectations) {
    const guest = await newGuest(request, fh, { stayType });
    const catalog: GuestFnbCatalogView = await guestMenus(request, guest.token);
    const item = catalog.menus
      .flatMap((m) => m.sections)
      .flatMap((s) => s.items)
      .find((i) => i.id === halfBoardOnly.id)!;
    expect(item.included, stayType).toBe(included);
    expect(item.unitPrice, stayType).toBe(price);
    expect(catalog.stayType, 'profile stay type echoed').toBe(stayType);
  }
});

test('16.2 AC4 — one variant group: absolute option prices; included items carry zero-priced options', async ({
  request,
}) => {
  const menu = await createMenuOk(request, fh.hotel.ownerToken, {
    nameEn: 'Variant Menu',
    nameAr: 'قائمة الأحجام',
    defaultIncludedFor: ['all_inclusive'],
  });
  const section = await createSectionOk(request, fh.hotel.ownerToken, menu.id, { nameEn: 'Coffees', nameAr: 'القهوة' });
  const coffee = await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'Latte',
    nameAr: 'لاتيه',
    price: 50,
    variant: {
      nameEn: 'Size',
      nameAr: 'الحجم',
      options: [
        { nameEn: 'Medium', nameAr: 'وسط', price: 80 },
        { nameEn: 'Large', nameAr: 'كبير', price: 110 },
      ],
    },
  });
  expect(coffee.variant).toBeTruthy();

  const ai = await newGuest(request, fh, { stayType: 'all_inclusive' });
  const aiCatalog = await guestMenus(request, ai.token);
  const aiItem = aiCatalog.menus.flatMap((m) => m.sections).flatMap((s) => s.items).find((i) => i.id === coffee.id)!;
  expect(aiItem.included).toBe(true);
  expect(aiItem.unitPrice).toBe(0);
  expect(aiItem.variant!.options.map((o) => o.unitPrice)).toEqual([0, 0]);

  const ro = await newGuest(request, fh, { stayType: 'room_only' });
  const roCatalog = await guestMenus(request, ro.token);
  const roItem = roCatalog.menus.flatMap((m) => m.sections).flatMap((s) => s.items).find((i) => i.id === coffee.id)!;
  expect(roItem.included).toBe(false);
  expect(roItem.unitPrice).toBe(80); // "from 80" — lowest option price
  expect(roItem.variant!.options.map((o) => o.unitPrice)).toEqual([80, 110]);
});

test('16.2 AC5 — notes off per item: ordering with a note → 400 FNB_NOTE_NOT_ALLOWED', async ({
  request,
}) => {
  const menu = await createMenuOk(request, fh.hotel.ownerToken, { nameEn: 'NoNotes Menu', nameAr: 'بدون ملاحظات' });
  const section = await createSectionOk(request, fh.hotel.ownerToken, menu.id, { nameEn: 'S', nameAr: 'ق' });
  const item = await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'Set Dessert',
    nameAr: 'حلوى المجموعة',
    price: 40,
    allowNotes: false,
  });

  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const withNote = await import('./helpers').then((h) =>
    h.placeOrder(request, guest.token, {
      lines: [{ itemId: item.id, quantity: 1, note: 'extra sugar' }],
      destination: { type: 'room' },
      paymentMethod: 'cash',
    }),
  );
  expect(withNote.status).toBe(400);
  expect(withNote.body.code).toBe('FNB_NOTE_NOT_ALLOWED');

  const clean = await import('./helpers').then((h) =>
    h.placeOrderOk(request, guest.token, {
      lines: [{ itemId: item.id, quantity: 1 }],
      destination: { type: 'room' },
      paymentMethod: 'cash',
    }),
  );
  expect(clean.lines[0].note).toBeNull();
});

test('16.2 AC6 — snapshot rule: order history survives rename/reprice/deactivate; audit carries diffs', async ({
  request,
}) => {
  const menu = await createMenuOk(request, fh.hotel.ownerToken, { nameEn: 'Snapshot Menu', nameAr: 'قائمة اللقطة' });
  const section = await createSectionOk(request, fh.hotel.ownerToken, menu.id, { nameEn: 'S', nameAr: 'ق' });
  const item = await createItemOk(request, fh.hotel.ownerToken, section.id, {
    nameEn: 'Original Pizza',
    nameAr: 'بيتزا أصلية',
    price: 100,
  });

  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const order = await import('./helpers').then((h) =>
    h.placeOrderOk(request, guest.token, {
      lines: [{ itemId: item.id, quantity: 2 }],
      destination: { type: 'room' },
      paymentMethod: 'cash',
    }),
  );

  // Mutate everything the order saw.
  const renamed = await apiPatch(request, `/tenant/fnb-menus/items/${item.id}`, {
    nameEn: 'Renamed Pizza',
    price: 145,
  }, fh.hotel.ownerToken);
  expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
  const deactivated = await apiPatch(request, `/tenant/fnb-menus/${menu.id}`, {
    isActive: false,
  }, fh.hotel.ownerToken);
  expect(deactivated.status).toBe(200);

  const guestView = await import('./helpers').then((h) => h.guestOrders(request, guest.token));
  const line = guestView.body.data.find((o) => o.id === order.id)!.lines[0];
  expect(line.itemName).toBe('Original Pizza');
  expect(line.unitPrice).toBe(100);
  expect(line.lineTotal).toBe(200);

  const tenantDetail = await apiGet<{ lines: Array<{ itemNameEn: string; unitPrice: number }> } & { code?: string }>(
    request,
    `/tenant/fnb-orders/${order.id}`,
    fh.hotel.ownerToken,
  );
  expect(tenantDetail.status).toBe(200);
  expect(tenantDetail.body.lines[0].itemNameEn).toBe('Original Pizza');
  expect(tenantDetail.body.lines[0].unitPrice).toBe(100);

  const meta = lastAuditMetaByMeta('fnb_menu.updated', fh.hotel.hotelId);
  expect(meta, 'fnb_menu.updated audit exists').toBeTruthy();
  const parsed = JSON.parse(meta!) as { diff?: Record<string, { from: unknown; to: unknown }> };
  expect(parsed.diff?.price ?? parsed.diff?.names ?? parsed.diff?.isActive).toBeTruthy();
});

test('16.x — module gating: a plan without `fnb` locks both dining surfaces (403 MODULE_NOT_ENABLED)', async ({
  request,
  adminToken,
}) => {
  const { createPlan, provisionHotel, createRoomsQuickly, standardTypeId, apiGetRetry } = await import('../../helpers/gxp-api');
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA NoFnb ${Date.now().toString(36)}`,
    enabledModules: ['requests', 'housekeeping', 'hotel_info'],
  });
  const noFnb = await provisionHotel(request, { epic: 'e16', tag: `nofnb${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, noFnb.ownerToken);
  await createRoomsQuickly(request, noFnb.ownerToken, type, ['760'], 7);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200&search=760',
    noFnb.ownerToken,
  );
  const guest = await import('./helpers').then((h) =>
    h.newGuest(request, { hotel: noFnb, rooms: { '760': list.body.data[0]!.id }, nextRoom: () => '760' }, {}),
  );
  const catalog = await apiGet(request, '/guest/fnb/menus', guest.token);
  expect(catalog.status).toBe(403);
  expect((catalog.body as { code?: string }).code).toBe('MODULE_NOT_ENABLED');

  const board = await apiGet(request, '/tenant/fnb-orders', noFnb.ownerToken);
  expect(board.status).toBe(403);
  expect((board.body as { code?: string }).code).toBe('MODULE_NOT_ENABLED');
});

test('16.x — permission edges: kitchen works menus but not locations/settings; bare reader locked out', async ({
  request,
}) => {
  const kitchen = await createStaffWithRole(request, fh.hotel.ownerToken, fh.hotel.slug, 'F&B / Kitchen');

  const menuOk = await apiPost16(request, '/tenant/fnb-menus', {
    nameEn: 'Kitchen Menu',
    nameAr: 'قائمة المطبخ',
  }, kitchen.token);
  expect(menuOk.status, JSON.stringify(menuOk.body)).toBe(201);

  const locationDenied = await apiPost16(request, '/tenant/fnb-locations', {
    nameEn: 'Terrace',
    nameAr: 'تراس',
  }, kitchen.token);
  expect(locationDenied.status).toBe(403);

  const settingsDenied = await apiGet(request, '/tenant/fnb/settings', kitchen.token);
  expect(settingsDenied.status).toBe(403);

  const reader = await createStaffWithRole(request, fh.hotel.ownerToken, fh.hotel.slug, 'Housekeeping');
  const treeDenied = await apiGet(request, '/tenant/fnb-menus', reader.token);
  expect(treeDenied.status).toBe(403);
});

// ------------------------------------------------------------------ utilities

async function apiPost16(
  request: Parameters<typeof apiGet>[0],
  path: string,
  body: Record<string, unknown>,
  token = fh.hotel.ownerToken,
): Promise<{ status: number; body: Record<string, unknown> & { code?: string } }> {
  const { apiPost } = await import('../../helpers/gxp-api');
  return apiPost(request, path, body, token);
}

async function apiDelete16(
  request: Parameters<typeof apiGet>[0],
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { API_URL } = await import('../../helpers/gxp-api');
  const res = await request.delete(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${fh.hotel.ownerToken}` },
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function menuTree(request: Parameters<typeof apiGet>[0]): Promise<{
  menus: Array<{ id: string; sections: Array<{ items: Array<{ id: string; photoThumbUrl: string | null }> }> }>;
}> {
  const res = await apiGet(request, '/tenant/fnb-menus', fh.hotel.ownerToken);
  expect(res.status).toBe(200);
  return res.body as unknown as { menus: Array<{ id: string; sections: Array<{ items: Array<{ id: string; photoThumbUrl: string | null }> }> }> };
}
