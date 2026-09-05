/**
 * Epic 16 — Story 16.5 guest browse/cart/order + 16.4 AC2/AC3 payment rules
 * + 16.5 AC5 throttles + 16.5 AC6 QR-param contract (API level).
 */
import { expect, test } from '../../fixtures';
import { apiPatch, provisionHotel } from '../../helpers/gxp-api';
import {
  createItemOk,
  createLocationOk,
  createMenuOk,
  createSectionOk,
  guestCancelOrder,
  guestMenus,
  guestOrders,
  newGuest,
  openWindow,
  closedWindow,
  placeOrder,
  placeOrderOk,
  provisionFnbHotel,
  type FnbHotel,
  type GuestFnbCatalogView,
  type GuestFnbItemView,
} from './helpers';

let fh: FnbHotel;
let other: FnbHotel;
let openMenuId: string;
let closedMenuId: string;
let aiMenuId: string;
let burger: { id: string; price: number };
let whiskey: { id: string };
let latte: { id: string; options: Array<{ key: string; unitPrice: number }> };
let croissant: { id: string };
let juice: { id: string };
let pool: { id: string; key: string };
let beach: { id: string };
let closedWindows: { start: string; end: string };

test.beforeAll(async ({ request, adminToken }) => {
  fh = await provisionFnbHotel(request, adminToken, `ord${Date.now().toString(36)}`, [
    '731', '732', '733', '734', '735', '736', '737', '738', '739', '740', '741', '742', '743',
  ]);
  other = await provisionFnbHotel(request, adminToken, `ordB${Date.now().toString(36)}`, ['791']);

  const token = fh.hotel.ownerToken;

  const allDay = await createMenuOk(request, token, {
    nameEn: 'All-Day Dining',
    nameAr: 'طعام على مدار اليوم',
    windows: [openWindow()],
    prepSlaMinutes: 20,
  });
  openMenuId = allDay.id;
  const mains = await createSectionOk(request, token, allDay.id, { nameEn: 'Mains', nameAr: 'الأطباق' });
  burger = await createItemOk(request, token, mains.id, { nameEn: 'Burger', nameAr: 'برجر', price: 120 });
  whiskey = await createItemOk(request, token, mains.id, {
    nameEn: 'Imported Whiskey',
    nameAr: 'ويسكي مستورد',
    price: 220,
    includedFor: [],
  });
  const drinks = await createSectionOk(request, token, allDay.id, { nameEn: 'Drinks', nameAr: 'مشروبات', sortOrder: 2 });
  const latteItem = await createItemOk(request, token, drinks.id, {
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
  latte = { id: latteItem.id, options: [] };

  const breakfast = await createMenuOk(request, token, {
    nameEn: 'Breakfast',
    nameAr: 'الفطور',
    windows: [closedWindow(90, 60)],
    prepSlaMinutes: 40,
  });
  closedMenuId = breakfast.id;
  closedWindows = closedWindow(90, 60);
  const bSection = await createSectionOk(request, token, breakfast.id, { nameEn: 'Bakery', nameAr: 'المخبوزات' });
  croissant = await createItemOk(request, token, bSection.id, { nameEn: 'Croissant', nameAr: 'كرواسون', price: 45 });

  const ai = await createMenuOk(request, token, {
    nameEn: 'AI Inclusive',
    nameAr: 'الشامل',
    windows: [openWindow()],
    defaultIncludedFor: ['all_inclusive'],
    prepSlaMinutes: 30,
  });
  aiMenuId = ai.id;
  const aiSection = await createSectionOk(request, token, ai.id, { nameEn: 'Refresh', nameAr: 'مشروبات' });
  juice = await createItemOk(request, token, aiSection.id, { nameEn: 'Fresh Juice', nameAr: 'عصير طازج', price: 60 });

  pool = await createLocationOk(request, token, {
    nameEn: 'Pool',
    nameAr: 'المسبح',
    hasSpots: true,
    spotLabelEn: 'Umbrella',
    spotLabelAr: 'شمسية',
  });
  beach = await createLocationOk(request, token, { nameEn: 'Beach', nameAr: 'الشاطئ' });
});

function findItem(catalog: GuestFnbCatalogView, id: string): GuestFnbItemView {
  const item = catalog.menus.flatMap((m) => m.sections).flatMap((s) => s.items).find((i) => i.id === id);
  expect(item, `item ${id} in the guest catalog`).toBeTruthy();
  return item!;
}

test('16.5 AC1 — catalog: availability annotated (closed menu visible with opensAt), prices for the stay type', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const catalog = await guestMenus(request, guest.token);

  const allDay = catalog.menus.find((m) => m.id === openMenuId)!;
  expect(allDay.availability.available).toBe(true);
  expect(allDay.availability.opensAt).toBeNull();
  expect(allDay.prepSlaMinutes).toBe(20);

  const breakfast = catalog.menus.find((m) => m.id === closedMenuId)!;
  expect(breakfast.availability.available).toBe(false);
  expect(breakfast.availability.opensAt).toBe(closedWindows.start);
  expect(breakfast.windows).toEqual([closedWindows]);
  // Browsable, not orderable — the items are still listed.
  expect(findItem(catalog, croissant.id).unitPrice).toBe(45);

  expect(findItem(catalog, burger.id).unitPrice).toBe(120);
  expect(findItem(catalog, burger.id).included).toBe(false);
  expect(findItem(catalog, whiskey.id).included).toBe(false); // explicit always-paid
  expect(catalog.currency).toBeTruthy();
  expect(catalog.paymentMethods).toEqual(['cash']);
  expect(catalog.locations.map((l) => l.key)).toContain('pool');
  expect(catalog.locations.find((l) => l.key === 'pool')?.spotLabel).toBe('Umbrella');
});

test('16.5 AC1 — language: ar guest sees Arabic names; ru guest falls back to EN', async ({
  request,
}) => {
  const ar = await newGuest(request, fh, { language: 'ar', stayType: 'room_only' });
  const arCatalog = await guestMenus(request, ar.token);
  expect(findItem(arCatalog, burger.id).name).toBe('برجر');
  expect(arCatalog.locations.find((l) => l.key === 'pool')?.name).toBe('المسبح');

  const ru = await newGuest(request, fh, { language: 'ru', stayType: 'room_only' });
  const ruCatalog = await guestMenus(request, ru.token);
  expect(findItem(ruCatalog, burger.id).name).toBe('Burger');
});

test('16.5 AC3 — mixed cart: totals are paid-only; included lines priced 0 with the flag set', async ({
  request,
}) => {
  const ai = await newGuest(request, fh, { stayType: 'all_inclusive' });
  const order = await placeOrderOk(request, ai.token, {
    lines: [
      { itemId: juice.id, quantity: 1 },
      { itemId: burger.id, quantity: 2 },
    ],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(order.totalAmount).toBe(240); // included juice contributes 0
  const juiceLine = order.lines.find((l) => l.itemName === 'Fresh Juice')!;
  const burgerLine = order.lines.find((l) => l.itemName === 'Burger')!;
  expect(juiceLine.included).toBe(true);
  expect(juiceLine.unitPrice).toBe(0);
  expect(juiceLine.lineTotal).toBe(0);
  expect(burgerLine.included).toBe(false);
  expect(burgerLine.lineTotal).toBe(240);

  // The board carries the same flags (kitchen sees ✓Included chips).
  const board = await import('./helpers').then((h) => h.fnbBoard(request, fh.hotel.ownerToken));
  const row = board.body.data.find((o) => o.id === order.id)!;
  expect(row.lines.find((l) => l.itemNameEn === 'Fresh Juice')!.included).toBe(true);
  expect(row.lines.find((l) => l.itemNameEn === 'Burger')!.lineTotal).toBe(240);
});

test('16.5 AC3/AC6 — server is the availability authority: closed/mixed orders 409; opening unblocks; SLA = max', async ({
  request,
}) => {
  // A menu owned by THIS test (fullyParallel: tests must not mutate shared
  // beforeAll state another test may assert on).
  const token = fh.hotel.ownerToken;
  const local = await createMenuOk(request, token, {
    nameEn: 'Local Breakfast',
    nameAr: 'فطور',
    windows: [closedWindow(90, 60)],
    prepSlaMinutes: 40,
  });
  const section = await createSectionOk(request, token, local.id, { nameEn: 'Bakery', nameAr: 'مخبوزات' });
  const item = await createItemOk(request, token, section.id, { nameEn: 'Croissant', nameAr: 'كرواسون', price: 45 });

  const guest = await newGuest(request, fh, { stayType: 'room_only' });

  const intoClosed = await placeOrder(request, guest.token, {
    lines: [{ itemId: item.id, quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(intoClosed.status).toBe(409);
  expect(intoClosed.body.code).toBe('MENU_UNAVAILABLE');
  expect(intoClosed.body.menuId).toBe(local.id);

  // Cart mixed across disjoint availability: every involved menu must be open.
  const mixed = await placeOrder(request, guest.token, {
    lines: [
      { itemId: burger.id, quantity: 1 },
      { itemId: item.id, quantity: 1 },
    ],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(mixed.status).toBe(409);
  expect(mixed.body.code).toBe('MENU_UNAVAILABLE');

  // The hotel opens the window → the same cart now lands; SLA = max involved.
  const open = await apiPatch(request, `/tenant/fnb-menus/${local.id}`, {
    windows: [openWindow(30, 90)],
  }, token);
  expect(open.status, JSON.stringify(open.body)).toBe(200);

  const nowFits = await placeOrderOk(request, guest.token, {
    lines: [
      { itemId: burger.id, quantity: 1 },
      { itemId: item.id, quantity: 1 },
    ],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(nowFits.slaTargetMinutes).toBe(40); // max(All-Day 20, local 40)
});

test('16.5 AC4 — destinations: room from the stay, location + spot, spot dropped without spots, invalid rejected', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });

  const room = await placeOrderOk(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(room.destinationType).toBe('room');
  expect(room.roomNumber).toBe(guest.roomNumber); // never client-typed

  const toPool = await placeOrderOk(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'location', locationId: pool.id, spot: '12' },
    paymentMethod: 'cash',
  });
  expect(toPool.destinationType).toBe('location');
  expect(toPool.locationName).toBe('Pool');
  expect(toPool.spot).toBe('12');

  const toBeach = await placeOrderOk(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'location', locationId: beach.id, spot: '7' },
    paymentMethod: 'cash',
  });
  expect(toBeach.spot).toBeNull(); // no numbered spots → the spot is dropped

  const badLocation = await placeOrder(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'location', locationId: '11111111-1111-4111-8111-111111111111' },
    paymentMethod: 'cash',
  });
  expect(badLocation.status).toBe(400);
  expect(badLocation.body.code).toBe('FNB_LOCATION_INVALID');

  // Cross-tenant location: 400 INVALID (never accepted, never a 403 leak).
  const foreign = await placeOrder(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'location', locationId: other.hotel.hotelId },
    paymentMethod: 'cash',
  });
  expect(foreign.status).toBe(400);
});

test('16.4 AC2/AC3 — payment: enabled methods enforced; fully-included orders skip the choice', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });

  const noMethod = await placeOrder(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'room' },
  });
  expect(noMethod.status).toBe(400);
  expect(noMethod.body.code).toBe('FNB_PAYMENT_METHOD_INVALID');

  const chargeOff = await placeOrder(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'room_charge',
  });
  expect(chargeOff.status).toBe(400);
  expect(chargeOff.body.code).toBe('FNB_PAYMENT_METHOD_INVALID');

  const cash = await placeOrderOk(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(cash.paymentMethod).toBe('cash');

  // All-Inclusive guest, all lines included: no method needed…
  const ai = await newGuest(request, fh, { stayType: 'all_inclusive' });
  const frictionless = await placeOrderOk(request, ai.token, {
    lines: [{ itemId: juice.id, quantity: 2 }],
    destination: { type: 'room' },
  });
  expect(frictionless.totalAmount).toBe(0);
  expect(frictionless.paymentMethod).toBeNull();

  // …and a method the client sends anyway is ignored (stored null).
  const ignored = await placeOrderOk(request, ai.token, {
    lines: [{ itemId: juice.id, quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(ignored.paymentMethod).toBeNull();

  // Opt in room charge → the method becomes acceptable for paid orders.
  const on = await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: true }, fh.hotel.ownerToken);
  expect(on.status).toBe(200);
  const roomBill = await placeOrderOk(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'room_charge',
  });
  expect(roomBill.paymentMethod).toBe('room_charge');
  const off = await apiPatch(request, '/tenant/fnb/settings', { roomChargeEnabled: false }, fh.hotel.ownerToken);
  expect(off.status).toBe(200);
});

test('16.5 — variant edges: bad option key and option-on-plain-item both 400 FNB_VARIANT_INVALID', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });

  const badKey = await placeOrder(request, guest.token, {
    lines: [{ itemId: latte.id, variantKey: 'nope', quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(badKey.status).toBe(400);
  expect(badKey.body.code).toBe('FNB_VARIANT_INVALID');

  const plain = await placeOrder(request, guest.token, {
    lines: [{ itemId: burger.id, variantKey: 'medium', quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(plain.status).toBe(400);
  expect(plain.body.code).toBe('FNB_VARIANT_INVALID');
});

test('16.5 AC6 — QR params are prefill-only: the session/room wins server-side', async ({
  request,
}) => {
  // There is NO server endpoint consuming ?location/?spot — destination comes
  // from the order body only (the UI prefill is covered in 16-7-ui). Here:
  // a room destination order stays bound to the stay's room even though a
  // sticker QR would have carried ?location=pool&spot=12.
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const order = await placeOrderOk(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  expect(order.destinationType).toBe('room');
  expect(order.roomNumber).toBe(guest.roomNumber);
  expect(order.spot).toBeNull();
});

test('16.5 AC5 — open throttle: the 6th open order → 429 FNB_LIMIT_OPEN; cancelling frees a seat', async ({
  request,
}) => {
  test.setTimeout(480_000);
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const input = {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'room' } as const,
    paymentMethod: 'cash',
  };

  const created: string[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await placeOrderOk(request, guest.token, input);
    created.push(res.id);
  }
  const sixth = await placeOrder(request, guest.token, input);
  expect(sixth.status).toBe(429);
  expect(sixth.body.code).toBe('FNB_LIMIT_OPEN');
  expect(sixth.body.limit).toBe(5);

  const cancel = await guestCancelOrder(request, guest.token, created[0]!);
  expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);

  const nowFits = await placeOrderOk(request, guest.token, input);
  expect(nowFits.status).toBe(201);
});

test('16.5 AC5 — daily throttle: the 21st order in a stay-day → 429 FNB_LIMIT_DAILY', async ({
  request,
}) => {
  test.setTimeout(600_000);
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const input = {
    lines: [{ itemId: burger.id, quantity: 1 }],
    destination: { type: 'room' } as const,
    paymentMethod: 'cash',
  };

  // Cancel each batch (guest-cancel is allowed while new) — cancellations
  // still count toward the daily bucket, so 20 creations exhaust it.
  for (let round = 0; round < 4; round++) {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await placeOrderOk(request, guest.token, input);
      ids.push(res.id);
    }
    for (const id of ids) {
      const cancel = await guestCancelOrder(request, guest.token, id);
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    }
  }

  const over = await placeOrder(request, guest.token, input);
  expect(over.status).toBe(429);
  expect(over.body.code).toBe('FNB_LIMIT_DAILY');
  expect(over.body.limit).toBe(20);
});

test('16.6 AC3 — guest history + tracking list: statuses, totals, delta polling cursor', async ({
  request,
}) => {
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  const before = await guestOrders(request, guest.token);
  expect(before.status).toBe(200);
  const cursor = before.body.serverTime;

  const order = await placeOrderOk(request, guest.token, {
    lines: [{ itemId: burger.id, quantity: 2 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  const list = await guestOrders(request, guest.token);
  const row = list.body.data.find((o) => o.id === order.id);
  expect(row).toBeTruthy();
  expect(row!.status).toBe('new');
  expect(row!.totalAmount).toBe(240);
  expect(row!.settled).toBe(false);

  const delta = await guestOrders(request, guest.token, cursor);
  expect(delta.status).toBe(200);
  expect(delta.body.data.map((o) => o.id)).toContain(order.id);
  expect(delta.body.serverTime).toBeTruthy();
});
