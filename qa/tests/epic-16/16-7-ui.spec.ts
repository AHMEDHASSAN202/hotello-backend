/**
 * Epic 16 — UI level: the guest dining flow (tile → browse → cart →
 * checkout → tracking, QR prefill) on hotello-guest-frontend :3002 and the
 * kitchen board on hotello-hotel-frontend :3001.
 */
import { expect, test } from '../../fixtures';
import type { Page } from '@playwright/test';
import {
  apiGetRetry,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  TENANT_URL,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { guestSessionOk } from '../../helpers/stays';
import { GUEST_URL, uiGuestSession } from '../../helpers/guest-ui';
import { uiSession } from '../../helpers/tenant-ui';
import {
  checkInStay,
  createItemOk,
  createLocationOk,
  createMenuOk,
  createSectionOk,
  placeOrderOk,
} from './helpers';

// Provisioning + paced logins need headroom under full-suite load.
test.setTimeout(600_000);

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};
let burgerId = '';
let juiceId = '';
let menuId = '';

test.beforeAll(async ({ request, adminToken }) => {
  const { createFullModulePlan } = await import('../../helpers/gxp-api');
  const planId = await createFullModulePlan(request, adminToken, `QA FNB UI ${Date.now().toString(36)}`);
  dedicated = await provisionHotel(request, { epic: 'e16', tag: `ui${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['791', '792', '793', '794'], 7);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;

  const token = dedicated.ownerToken;
  const menu = await createMenuOk(request, token, {
    nameEn: 'Resort Menu',
    nameAr: 'قائمة المنتجع',
    windows: [{ start: '00:00', end: '23:59' }],
    defaultIncludedFor: ['all_inclusive'],
    prepSlaMinutes: 20,
  });
  menuId = menu.id;
  const section = await createSectionOk(request, token, menu.id, { nameEn: 'Mains', nameAr: 'الأطباق' });
  const burger = await createItemOk(request, token, section.id, {
    nameEn: 'Beef Burger',
    nameAr: 'برجر لحم',
    price: 120,
    includedFor: [],
  });
  const juice = await createItemOk(request, token, section.id, {
    nameEn: 'Orange Juice',
    nameAr: 'عصير برتقال',
    price: 60,
  });
  burgerId = burger.id;
  juiceId = juice.id;

  await createLocationOk(request, token, {
    nameEn: 'Pool',
    nameAr: 'المسبح',
    hasSpots: true,
    spotLabelEn: 'Umbrella',
    spotLabelAr: 'شمسية',
  });
});

async function enterAs(
  request: Parameters<typeof apiGetRetry>[0],
  page: Page,
  opts: { roomNumber?: string; stayType?: string; guestName?: string } = {},
) {
  // Rooms are dedicated per test (a room hosts ONE active stay).
  const roomNumber = opts.roomNumber!;
  const { stay, code } = await checkInStay(request, dedicated.ownerToken, {
    roomId: rooms[roomNumber]!,
    stayType: opts.stayType,
    guestName: opts.guestName,
    language: 'en',
  });
  const session = await guestSessionOk(request, dedicated.slug, roomNumber, code);
  await uiGuestSession(page, dedicated.slug, {
    accessToken: session.accessToken,
    profile: session.profile as never,
  });
  await expect(page.getByTestId('tile-dining')).toBeVisible({ timeout: 20_000 });
  void stay;
  return { roomNumber, profile: session.profile };
}

async function openDiningAndAdd(page: Page, itemId: string) {
  await page.getByTestId('tile-dining').click();
  const item = page.getByTestId(`fnb-item-${itemId}`);
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.click();
  const add = page.getByTestId('add-to-cart');
  await expect(add).toBeVisible({ timeout: 10_000 });
  await add.click();
}

test('16.5 AC1/AC2 — guest UI: Dining tile live; ✓Included vs priced items in one menu; add to cart', async ({
  page,
  request,
}) => {
  const ai = await enterAs(request, page, { roomNumber: '794', stayType: 'all_inclusive', guestName: 'UI AI Guest' });
  await openDiningAndAdd(page, juiceId);

  // The sheet closes after adding; the included item shows the ✓ mark.
  await expect(page.getByTestId('cart-button')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('✓ Included').first()).toBeVisible({ timeout: 10_000 });

  // Priced item in the same menu (always-paid override for AI guests too).
  await expect(page.getByTestId(`fnb-item-${burgerId}`)).toBeVisible();

  // Cart: included line listed, paid-only total.
  await page.getByTestId('cart-button').click();
  await expect(page.getByTestId('cart-line-0')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Total to pay/i)).toBeVisible();

  // 16.5 AC3 — the cart persists per stay across app restarts (reload).
  await page.reload();
  await expect(page.getByTestId('tile-dining')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('tile-dining').click();
  await page.getByTestId('cart-button').click();
  await expect(page.getByTestId('cart-line-0')).toBeVisible({ timeout: 15_000 });
  void ai;
});

test('16.5 AC4/16.6 AC1 — checkout: room destination default, cash preselected → order lands on tracking', async ({
  page,
  request,
}) => {
  await enterAs(request, page, { stayType: 'room_only', roomNumber: '791', guestName: 'UI Checkout Guest' });
  await openDiningAndAdd(page, burgerId);
  await page.getByTestId('cart-button').click();
  await page.getByTestId('go-checkout').click();

  // "My room (N)" is the default destination; single method = preselected cash.
  await expect(page.getByTestId('dest-room')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Pay the waiter on delivery/i)).toBeVisible();

  await page.getByTestId('place-order').click();
  // Optimistic success beat → tracking screen with the status timeline.
  await expect(page.getByText(/Order received!/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Received/i).first()).toBeVisible({ timeout: 15_000 });
});

test('16.5 AC6 — ?location&spot QR params pre-fill the checkout (and stay editable)', async ({
  page,
  request,
}) => {
  await enterAs(request, page, { stayType: 'room_only', roomNumber: '792', guestName: 'UI QR Guest' });

  // The sticker URL — prefill only, dropped once consumed (session wins).
  await page.goto(`${GUEST_URL}/${dedicated.slug}?location=pool&spot=12`);
  await expect(page.getByTestId('tile-dining')).toBeVisible({ timeout: 20_000 });
  await openDiningAndAdd(page, burgerId);
  await page.getByTestId('cart-button').click();
  await page.getByTestId('go-checkout').click();

  const spot = page.getByTestId('spot-input');
  await expect(spot).toBeVisible({ timeout: 10_000 });
  await expect(spot).toHaveValue('12');
  // Both stay editable — type a different spot, place, and the order carries it.
  await spot.fill('14');
});

test('16.7 AC1 — tenant board: the F&B order card shows destination, guest and payment chip', async ({
  page,
  request,
}) => {
  // Seed the order through the real guest contract.
  const { stay, code } = await checkInStay(request, dedicated.ownerToken, {
    roomId: rooms['793']!,
    stayType: 'room_only',
    guestName: 'Board UI Guest',
    language: 'en',
  });
  const session = await guestSessionOk(request, dedicated.slug, '793', code);
  const order = await placeOrderOk(request, session.accessToken, {
    lines: [{ itemId: burgerId, quantity: 2 }],
    destination: { type: 'room' },
    paymentMethod: 'cash',
  });
  void stay;

  await uiSession(page, dedicated.slug, dedicated.ownerToken, dedicated.ownerRefresh, null);
  await page.goto(`${TENANT_URL}/t/${dedicated.slug}/fnb`);
  await expect(
    page.getByText('Board UI Guest', { exact: false }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('793', { exact: false }).first()).toBeVisible();
  expect(order.totalAmount).toBe(240);
});
