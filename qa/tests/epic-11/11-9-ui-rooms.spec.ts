/**
 * Epic 11 — Tenant Dashboard UI flows (rooms module), real browser against
 * the Next.js tenant app on :3001.
 *
 * Number range 9xx, floor 10 (reserved for this suite in the shared worker
 * hotel). Sessions are injected via localStorage (the app's own tokenStore
 * keys) except the login-form test, which drives the real sign-in screen.
 */
import { expect, test } from '../../fixtures';
import {
  apiPost,
  createPlan,
  createRoomsQuickly,
  createStaffUser,
  guestBaseUrl,
  provisionHotel,
  TENANT_URL,
} from '../../helpers/gxp-api';

const ROOMS_URL = (slug: string) => `${TENANT_URL}/t/${slug}/rooms`;
const TYPES_URL = (slug: string) => `${TENANT_URL}/t/${slug}/rooms/types`;
const QR_URL = (slug: string) => `${TENANT_URL}/t/${slug}/rooms/qr`;

/**
 * Establish the session exactly the way the app's `lib/auth.ts` does:
 * localStorage tokens + the middleware cookie flag.
 */
async function uiSession(
  page: import('@playwright/test').Page,
  slug: string,
  accessToken: string,
  refreshToken: string,
  awaitNav: string | null = 'Rooms',
) {
  // The middleware cookie flag must exist BEFORE the first navigation.
  await page.context().addCookies([
    { name: 'gxp_tenant_auth', value: '1', url: TENANT_URL, sameSite: 'Lax' },
  ]);
  await page.addInitScript(
    ([access, refresh]) => {
      window.localStorage.setItem('gxp_tenant_access_token', access!);
      window.localStorage.setItem('gxp_tenant_refresh_token', refresh!);
    },
    [accessToken, refreshToken] as const,
  );
  await page.goto(`${TENANT_URL}/t/${slug}`);
  if (awaitNav) {
    await expect(page.getByRole('link', { name: awaitNav })).toBeVisible();
  }
}

test('11.6 AC4 — an empty hotel gets onboarding copy, not a blank table', async ({
  page,
  request,
  adminToken,
}) => {
  // Needs a hotel with zero rooms — the shared worker hotel accumulates rooms
  // from other suites.
  const h = await provisionHotel(request, { epic: 'e11', tag: `uie${Date.now().toString(36)}`, adminToken });
  await uiSession(page, h.slug, h.ownerToken, h.ownerRefresh);
  await page.goto(ROOMS_URL(h.slug));
  await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible();
  await expect(page.getByText('No rooms yet')).toBeVisible();
});

test('11.2 AC3 — usage badge shows used vs plan max ("4 / 5 rooms")', async ({
  page,
  request,
  adminToken,
}) => {
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA UI 5 ${Date.now().toString(36)}`,
    maxRooms: 5,
  });
  const h = await provisionHotel(request, { epic: 'e11', tag: `uib${Date.now().toString(36)}`, planId, adminToken });
  const type = await import('../../helpers/gxp-api').then((m) => m.standardTypeId(request, h.ownerToken));
  await createRoomsQuickly(request, h.ownerToken, type, ['111', '112', '113', '114'], 10);

  await uiSession(page, h.slug, h.ownerToken, h.ownerRefresh);
  await page.goto(ROOMS_URL(h.slug));
  await expect(page.getByText('4 / 5 rooms')).toBeVisible();
  // 4/5 = 80% — at the threshold the badge must turn amber (4.6 pattern).
  const badge = page.getByText('4 / 5 rooms');
  await expect(badge).toHaveClass(/amber/, { timeout: 10_000 });
});

test('11.2 AC2 — list renders in natural order with status badges', async ({
  page,
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(
    request,
    hotel.ownerToken,
    standardType.id,
    ['991', '910', '992', '9', '991A'],
    10,
  );
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(ROOMS_URL(hotel.slug));

  // Scope to this suite's numbers via search (the shared hotel holds other
  // suites' rooms).
  await page.getByLabel('Search rooms').fill('99');
  await page.getByRole('button', { name: 'Search' }).click();

  const firstColumn = page.locator('table tbody tr td:first-child');
  await expect(firstColumn).toHaveText(['991', '991A', '992']);
  await expect(page.getByText('Active').first()).toBeVisible();
});

test('11.3 AC1/AC2 — Add room modal: single create and bulk range with preview', async ({
  page,
  hotel,
  standardType,
}) => {
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(ROOMS_URL(hotel.slug));

  await page.getByRole('button', { name: 'Add room' }).first().click();
  await expect(page.getByText('Add one room at a time.')).toBeVisible();

  // Single room.
  await page.getByLabel('Room number').fill('901');
  await page.getByLabel('Floor (optional)').fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Add room' }).click();
  await expect(page.getByLabel('Search rooms')).toBeVisible(); // back on the page
  await page.getByLabel('Search rooms').fill('901');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('table tbody tr td:first-child')).toHaveText(['901']);

  // Bulk range with preview → confirm.
  await page.getByRole('button', { name: 'Add room' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Range of rooms').click();
  // Labels wrap hints, so accessible names are prefixes like "From *" and
  // "To Numeric ranges only…".
  await dialog.getByRole('spinbutton', { name: /^From/ }).fill('911');
  await dialog.getByRole('spinbutton', { name: /^To/ }).fill('915');
  await dialog.getByRole('spinbutton', { name: /^Floor/ }).fill('11');
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.getByText('This will create 5 rooms.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create 5 rooms' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel('Search rooms').fill('911');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('table tbody tr td:first-child')).toHaveText(['911']);
  // Broader search '91' also matches this suite's other 9x1/99x rooms when
  // they exist (full-run context), so assert the range's relative order.
  await page.getByLabel('Search rooms').fill('91');
  await page.getByRole('button', { name: 'Search' }).click();
  const numbers = await page.locator('table tbody tr td:first-child').allInnerTexts();
  const range = numbers.filter((n) => ['911', '912', '913', '914', '915'].includes(n));
  expect(range).toEqual(['911', '912', '913', '914', '915']);
  expect(numbers.every((n) => /^9[0-9]{1,2}A?$/.test(n))).toBe(true);
});

test('11.3 AC1 — duplicate room number surfaces an inline API error', async ({
  page,
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['921'], 10);
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(ROOMS_URL(hotel.slug));

  await page.getByRole('button', { name: 'Add room' }).first().click();
  await page.getByLabel('Room number').fill('921');
  await page.getByRole('dialog').getByRole('button', { name: 'Add room' }).click();
  await expect(page.locator('[role="alert"]').first()).toBeVisible();
});

test('11.1 AC1 — room types: create via the modal and see it listed', async ({
  page,
  hotel,
}) => {
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(TYPES_URL(hotel.slug));
  await expect(page.getByRole('heading', { name: 'Room types' })).toBeVisible();
  await expect(page.getByText('Standard').first()).toBeVisible();

  await page.getByRole('button', { name: 'New room type' }).click();
  await page.getByLabel('Name (English)').fill('Penthouse');
  await page.getByLabel('Name (Arabic)').fill('بنتهاوس');
  await page.getByRole('button', { name: 'Create room type' }).click();
  await expect(page.getByText('Penthouse')).toBeVisible();
});

test('11.1 AC3 — deactivating an in-use type shows the 409 count message', async ({
  page,
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['931'], 10);
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(TYPES_URL(hotel.slug));

  await page.getByLabel('Deactivate Standard').first().click();
  const dialog = page.getByRole('dialog');
  // Confirming must FAIL (rooms are assigned) — the 409 count message tells
  // the user how many rooms still use the type, and the type stays active.
  await dialog.getByRole('button', { name: 'Deactivate' }).click();
  await expect(dialog.getByText(/still assigned to \d+ rooms?/)).toBeVisible();
  // The card still offers Activate-style state? No — it must remain active.
  await expect(page.getByLabel('Deactivate Standard').first()).toBeVisible();
});

test('11.5 AC3 — the room QR modal shows the QR image and the raw guest link', async ({
  page,
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['941'], 10);
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(ROOMS_URL(hotel.slug));

  await page.getByLabel('View QR code for room 941').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('QR code — Room 941')).toBeVisible();
  await expect(dialog.locator('img')).toBeVisible();
  await expect(
    dialog.getByText(`${guestBaseUrl()}/${hotel.slug}?room=941`),
  ).toBeVisible();
});

test('11.5 AC1/AC2 — the QR page offers poster + cards PDF downloads', async ({
  page,
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['951'], 10);
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(QR_URL(hotel.slug));

  await expect(page.getByRole('heading', { name: 'QR codes' })).toBeVisible();
  await expect(page.getByText('General QR poster')).toBeVisible();

  const poster = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download poster' }).click();
  expect((await poster).suggestedFilename()).toMatch(/\.pdf$/);

  const cards = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download cards (PDF)' }).click();
  expect((await cards).suggestedFilename()).toMatch(/\.pdf$/);
});

test('11.2 AC1 — nav hides Rooms for staff without rooms.read; direct URL shows no-access', async ({
  page,
  request,
  hotel,
}) => {
  const staff = await createStaffUser(request, hotel.ownerToken, hotel.slug, [
    'staff.read',
  ]);
  // Staff without rooms.read: wait for any nav item EXCEPT Rooms.
  await uiSession(page, hotel.slug, staff.token, staff.refreshToken, 'Staff');

  await expect(page.getByRole('link', { name: 'Rooms' })).toHaveCount(0);

  await page.goto(ROOMS_URL(hotel.slug));
  await expect(page.getByText("You don't have access to rooms")).toBeVisible();
});

test('login — wrong password shows the generic error (no enumeration)', async ({
  page,
  hotel,
}) => {
  await page.goto(`${TENANT_URL}/t/${hotel.slug}/login`);
  await page.getByLabel('Email or username').fill(hotel.ownerEmail);
  await page.getByLabel('Password').fill('WrongPass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('[role="alert"], .text-danger').first()).toBeVisible({
    timeout: 10_000,
  });
});
