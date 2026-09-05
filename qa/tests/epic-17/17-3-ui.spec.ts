/**
 * Epic 17 — UI surfaces: the guest tile tri-state + the guest directory
 * screen (guest app :3002) and the tenant management page (:3001).
 *
 * All content is seeded via the API BEFORE any UI visit: the public profile
 * (60s TTL per slug) and the guest directory (60s per hotel:language) would
 * otherwise serve stale tri-state signals. Serial mode pins the file to one
 * worker so the three-hotel beforeAll runs once; the one test blocked by
 * QA-17-001 (tenant reorder wiring) is LAST so a serial skip can't hide it.
 */
import { expect, test } from '../../fixtures';
import type { Page } from '@playwright/test';
import {
  TENANT_URL,
  apiGetRetry,
  createFullModulePlan,
  createPlan,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestName, guestSessionSteady } from '../../helpers/stays';
import { uiGuestSession } from '../../helpers/guest-ui';
import { uiSession } from '../../helpers/tenant-ui';
import { createEntry, overview, putAbout, putEssentials, utcTimePlus } from './helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

const hotels: Record<string, ProvisionedHotel> = {};
const roomsByHotel = new Map<string, Record<string, string>>();
/** The "Opens at" badge value of the late spa (computed once in beforeAll). */
let badgeOpensAt = '';

async function addRooms(request: Parameters<typeof apiGetRetry>[0], hotel: ProvisionedHotel, numbers: string[]) {
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, numbers, 7);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    hotel.ownerToken,
  );
  const map: Record<string, string> = {};
  for (const room of list.body.data) map[room.roomNumber] = room.id;
  roomsByHotel.set(hotel.slug, map);
}

test.beforeAll(async ({ request, adminToken }) => {
  test.setTimeout(600_000);
  const fullPlan = await createFullModulePlan(request, adminToken, `QA E17 UI Full ${Date.now().toString(36)}`);
  const offPlan = await createPlan(request, adminToken, {
    nameEn: `QA E17 UI Off ${Date.now().toString(36)}`,
    enabledModules: ['requests', 'fnb', 'housekeeping', 'guest_app_branding'],
  });

  // Arm 1 — module OFF: the tile shows "Soon".
  hotels.off = await provisionHotel(request, { epic: 'e17', tag: `uioff${Date.now().toString(36)}`, planId: offPlan, adminToken });
  await addRooms(request, hotels.off, ['711', '712']);

  // Arm 2 — module ON + zero content: the tile is hidden entirely.
  hotels.empty = await provisionHotel(request, { epic: 'e17', tag: `uiemp${Date.now().toString(36)}`, planId: fullPlan, adminToken });
  await addRooms(request, hotels.empty, ['721', '722']);

  // Arm 3 — module ON + content: live. Seed BEFORE any UI visit.
  hotels.live = await provisionHotel(request, { epic: 'e17', tag: `uiliv${Date.now().toString(36)}`, planId: fullPlan, adminToken });
  await addRooms(request, hotels.live, ['731', '732', '733', '734', '735']);
  const ess = await putEssentials(request, hotels.live.ownerToken, {
    wifiName: 'Hotello-Guest',
    wifiPassword: 'sunrise2026',
    receptionPhone: '+20 100 123 4567',
  });
  expect(ess.status, JSON.stringify(ess.body)).toBe(200);
  const pool = await createEntry(request, hotels.live.ownerToken, {
    section: 'facilities',
    nameEn: 'Rooftop Pool',
    nameAr: 'مسبح السطح',
    windows: [],
    locationNoteEn: 'Rooftop, elevator to 9',
  });
  expect(pool.status).toBe(201);
  // Badge pair in the SAME hotel: open RIGHT NOW (window covering the seed
  // moment) vs opening ~2h after seed time. NOTE: `windows: []` (always
  // open) deliberately renders NO badge — same rule as F&B menus — so the
  // "Open now" arm needs a real window.
  badgeOpensAt = utcTimePlus(120);
  const gym = await createEntry(request, hotels.live.ownerToken, {
    section: 'facilities',
    nameEn: 'Always Open Gym',
    nameAr: 'جيم',
    windows: [{ start: utcTimePlus(-60), end: utcTimePlus(60) }],
  });
  const spa = await createEntry(request, hotels.live.ownerToken, {
    section: 'facilities',
    nameEn: 'Late Spa',
    nameAr: 'سبا',
    windows: [{ start: badgeOpensAt, end: utcTimePlus(180) }],
  });
  expect(gym.status).toBe(201);
  expect(spa.status).toBe(201);
  const laundry = await createEntry(request, hotels.live.ownerToken, {
    section: 'services',
    nameEn: 'Laundry',
    nameAr: 'غسيل ملابس',
    howToEn: 'Hand the bag at the desk before 9:00',
  });
  expect(laundry.status).toBe(201);
  const quiet = await createEntry(request, hotels.live.ownerToken, {
    section: 'house_rules',
    nameEn: 'Quiet hours',
    nameAr: 'ساعات الهدوء',
  });
  expect(quiet.status).toBe(201);
  const about = await putAbout(request, hotels.live.ownerToken, {
    descriptionEn: 'A calm boutique hotel in the heart of the city.',
    descriptionAr: 'فندق بوتيك هادئ في قلب المدينة.',
  });
  expect(about.status).toBe(200);
});

async function enterAs(
  request: Parameters<typeof checkInOk>[0],
  page: Page,
  hotel: ProvisionedHotel,
  roomNumber: string,
  guest: string,
  language = 'en',
) {
  const { code } = await checkInOk(request, hotel.ownerToken, {
    roomId: roomsByHotel.get(hotel.slug)![roomNumber],
    guestName: guest,
    language,
  });
  const session = await guestSessionSteady(request, hotel.slug, roomNumber, code);
  const body = session.body as unknown as {
    accessToken: string;
    profile: { guestName: string; roomNumber: string; language: string; checkOutDate: string };
  };
  expect(session.status, JSON.stringify(session.body)).toBe(200);
  await uiGuestSession(page, hotel.slug, { accessToken: body.accessToken, profile: body.profile });
  await expect(page.getByText(guest, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

test('17.2 AC1/AC4 — module off: the Hotel info tile shows "Soon" and does not open', async ({
  page,
  request,
}) => {
  await enterAs(request, page, hotels.off, '711', guestName());
  const tile = page.locator('[data-testid="tile-info"]');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute('aria-disabled', 'true');
  await expect(tile.getByText('Soon')).toBeVisible();

  // No bottom-nav info slot in this state (the slot exists only when live).
  await expect(page.getByRole('button', { name: 'Hotel info' })).toHaveCount(0);
});

test('17.2 AC4 — module on, zero content: the tile is hidden entirely', async ({ page, request }) => {
  await enterAs(request, page, hotels.empty, '721', guestName());
  await expect(page.locator('[data-testid="tile-info"]')).toHaveCount(0);
  // The rest of the grid still renders (this hotel has live requests/fnb).
  await expect(page.getByText('Requests', { exact: true }).first()).toBeVisible();
});

test('17.2 AC1/AC2 — live: nav slot appears and the directory opens, Essentials pinned first', async ({
  page,
  request,
}) => {
  await enterAs(request, page, hotels.live, '731', guestName());

  const tile = page.locator('[data-testid="tile-info"]');
  await expect(tile).toBeVisible();
  await expect(tile).not.toHaveAttribute('aria-disabled', 'true');
  await tile.click();

  await expect(page.getByRole('heading', { name: 'Hotel info' })).toBeVisible({ timeout: 15_000 });
  // AC2: Essentials rendered ABOVE the Facilities section.
  const essentialsBox = await page.getByRole('heading', { name: 'Essentials' }).boundingBox();
  const facilitiesBox = await page.getByRole('heading', { name: 'Facilities' }).boundingBox();
  expect(essentialsBox?.y ?? -1, 'essentials pinned first').toBeLessThan(facilitiesBox?.y ?? 99999);

  // The Essentials card content + tap-to-call links.
  await expect(page.getByText('Hotello-Guest')).toBeVisible();
  await expect(page.getByText('sunrise2026')).toBeVisible();
  await expect(page.locator('a[href="tel:+20 100 123 4567"]')).toBeVisible();
  // The bottom-nav info slot is live only now (AC1).
  await expect(page.getByRole('button', { name: 'Hotel info' })).toBeVisible();
});

test('17.2 AC2 — the WiFi password has tap-to-copy with a "Copied" feedback beat', async ({
  page,
  request,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await enterAs(request, page, hotels.live, '732', guestName());
  await page.locator('[data-testid="tile-info"]').click();

  const copy = page.getByRole('button', { name: 'Copy', exact: true }).first();
  await expect(copy).toBeVisible({ timeout: 15_000 });
  await copy.click();
  await expect(page.getByText('Copied')).toBeVisible();
});

test('17.2 AC2 — badges: "Open now" vs "Opens at HH:MM" computed from the entry windows', async ({
  page,
  request,
}) => {
  await enterAs(request, page, hotels.live, '733', guestName());
  await page.locator('[data-testid="tile-info"]').click();

  await expect(page.getByRole('heading', { name: 'Hotel info' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Open now')).toBeVisible();
  await expect(page.getByText(`Opens at ${badgeOpensAt}`)).toBeVisible();
});

test('17.2 AC3 — an ar guest reads the directory in Arabic', async ({ page, request }) => {
  await enterAs(request, page, hotels.live, '734', guestName(), 'ar');
  await page.locator('[data-testid="tile-info"]').click();
  await expect(page.getByText('مسبح السطح')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('ساعات الهدوء')).toBeVisible();
});

test('17.1 AC4 + tenant UI — the guidance-first management page, active toggle, essentials form', async ({
  page,
  request,
  adminToken,
}) => {
  const planId = await createFullModulePlan(request, adminToken, `QA E17 TUI ${Date.now().toString(36)}`);
  const h = await provisionHotel(request, { epic: 'e17', tag: `tui${Date.now().toString(36)}`, planId, adminToken });
  await uiSession(page, h.slug, h.ownerToken, h.ownerRefresh, null);
  await page.goto(`${TENANT_URL}/t/${h.slug}/hotel-info`);

  // 17.1 AC4 — the guidance DoD: PageIntro + the 80% HintCard.
  await expect(page.getByRole('heading', { name: 'Hotel info' })).toBeVisible();
  await expect(page.getByText('Start with WiFi and facility hours')).toBeVisible();
  await expect(page.getByText(/80% of what guests ask the desk/)).toBeVisible();

  // Designed empty states for the three repeatable sections.
  await expect(page.getByText('No facilities yet')).toBeVisible();
  await expect(page.getByText('No services yet')).toBeVisible();
  await expect(page.getByText('No rules yet')).toBeVisible();

  // Seed two facilities via the API; the rows appear in the editor.
  const a = await createEntry(request, h.ownerToken, { section: 'facilities', nameEn: 'UI Pool', nameAr: 'مسبح' });
  const b = await createEntry(request, h.ownerToken, { section: 'facilities', nameEn: 'UI Gym', nameAr: 'جيم' });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  await page.reload();

  const facilitiesSection = page.locator('section', { has: page.getByRole('heading', { name: 'Facilities' }) });
  const rows = facilitiesSection.locator('ul > li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('UI Pool');

  // Active-toggle wiring: "Hide from guests" lands as isActive=false.
  await facilitiesSection.getByRole('button', { name: 'Hide from guests' }).first().click();
  await expect(facilitiesSection.getByText('Hidden', { exact: true })).toBeVisible({ timeout: 15_000 });
  const toggled = (await overview(request, h.ownerToken)).facilities;
  expect(toggled.find((f) => f.names.en === 'UI Pool')?.isActive).toBe(false);

  // The Essentials form round-trips through the PUT.
  await page.getByLabel('WiFi network name').fill('TUI-WiFi');
  await page.getByLabel('WiFi password').fill('tui-pass-1');
  await page.getByRole('button', { name: 'Save essentials' }).click();
  await page.reload();
  await expect(page.getByLabel('WiFi network name')).toHaveValue('TUI-WiFi');
  await expect(page.getByLabel('WiFi password')).toHaveValue('tui-pass-1');
});

test('17.1 AC3 + tenant UI — reorder wiring: "Move up" reorders the section [QA-17-001]', async ({
  page,
  request,
}) => {
  // KNOWN FAILING — QA-17-001: the reorder endpoint 500s, so the editor
  // shows its row error and the order never changes. The UI test asserts
  // the correct behavior and stays red with the API test.
  const token = hotels.live.ownerToken;
  const c = await createEntry(request, token, { section: 'house_rules', nameEn: 'UI Rule 1', nameAr: '١' });
  const d = await createEntry(request, token, { section: 'house_rules', nameEn: 'UI Rule 2', nameAr: '٢' });
  expect(c.status).toBe(201);
  expect(d.status).toBe(201);

  await page.goto(`${TENANT_URL}/t/${hotels.live.slug}/hotel-info`);
  const rulesSection = page.locator('section', { has: page.getByRole('heading', { name: 'House rules & good to know' }) });
  const rules = rulesSection.locator('ul > li');
  await expect(rules).toHaveCount(2);
  await expect(rules.first()).toContainText('UI Rule 1');

  await rulesSection.getByRole('button', { name: 'Move up' }).nth(1).click();
  await expect(rules.first()).toContainText('UI Rule 2', { timeout: 15_000 });
  const apiOrder = (await overview(request, token)).houseRules.map((f) => f.names.en);
  expect(apiOrder[0]).toBe('UI Rule 2');
});
