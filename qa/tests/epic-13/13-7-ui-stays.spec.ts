/**
 * Epic 13 — Tenant Dashboard UI flows for stays.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPost,
  createRoomsQuickly,
  standardTypeId,
  TENANT_URL,
} from '../../helpers/gxp-api';
import { guestSession, guestSessionSteady } from '../../helpers/stays';
import { uiSession } from '../../helpers/tenant-ui';

const STAYS_URL = (slug: string) => `${TENANT_URL}/t/${slug}/stays`;
const API = process.env.GXP_API_URL ?? 'http://localhost:4000/api/v1';

async function roomsById(
  request: Parameters<typeof apiPost>[0],
  token: string,
): Promise<Record<string, string>> {
  const res = await apiGet<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    token,
  );
  const map: Record<string, string> = {};
  for (const room of res.body.data) map[room.roomNumber] = room.id;
  return map;
}

function todayPlusUi(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function openStays(page: import('@playwright/test').Page, hotel: { slug: string; ownerToken: string; ownerRefresh: string }) {
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(STAYS_URL(hotel.slug));
  await expect(page.getByRole('heading', { name: 'Stays' })).toBeVisible();
}

test('13.1/13.5 — check in via the UI modal; the shown code opens a guest session', async ({
  page,
  request,
  hotel,
}) => {
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['481', '482'], 15);

  await openStays(page, hotel);
  await page.getByRole('button', { name: 'Check in guest' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Check in a guest')).toBeVisible();

  await dialog.getByLabel('Guest name').fill('UI Checkin Guest');
  await dialog.getByLabel('Search available rooms').fill('481');
  await dialog.getByRole('button', { name: /^481/ }).first().click();

  await dialog.getByLabel(/Check-out date/).fill(todayPlusUi(4));
  await dialog.getByRole('button', { name: 'Check in', exact: true }).click();

  // Success screen shows the code exactly once.
  await expect(dialog.getByText('UI Checkin Guest is checked in')).toBeVisible();
  const dialogText = await dialog.innerText();
  const code = dialogText.match(/\b\d{6}\b/)?.[0];
  expect(code, 'success screen shows the 6-digit code').toBeTruthy();

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.locator('table tbody')).toContainText('UI Checkin Guest');

  // Cross-surface: the code the desk saw opens a real guest session.
  const session = await guestSessionSteady(request, hotel.slug, '481', code!);
  expect(session.status).toBe(200);
});

test('13.2/13.4 — occupancy badge on rooms; checkout via UI lands in history', async ({
  page,
  request,
  hotel,
  standardType,
}) => {
  const { checkInOk } = await import('../../helpers/stays');
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['483'], 15);
  const rooms = await roomsById(request, hotel.ownerToken);
  const { stay } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['483'] });

  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh);
  await page.goto(`${TENANT_URL}/t/${hotel.slug}/rooms`);
  const roomRow = page.locator('table tbody tr', { hasText: '483' });
  await expect(roomRow).toContainText('Occupied');

  await page.goto(STAYS_URL(hotel.slug));
  const stayRow = page.locator('table tbody tr', { hasText: '483' });
  await stayRow.getByRole('button', { name: 'View' }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByText('Stay details')).toBeVisible();

  await detail.getByRole('button', { name: 'Check out', exact: true }).click();
  // The confirm rides above the detail modal — take the topmost button.
  await page.getByRole('button', { name: 'Check out', exact: true }).last().click();

  // The detail stays open, now showing the ended stay.
  await expect(detail.getByText('Checked out').first()).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(detail).toHaveCount(0);

  // The active board no longer lists the guest (full name — shared hotels
  // hold other suites' QA Guest-* rows).
  await expect(page.locator('table tbody')).not.toContainText(stay.guestName);

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('table tbody')).toContainText(stay.guestName);
  await expect(page.locator('table tbody')).toContainText('Manual');
});

test('13.4 AC2 — stay settings card edits the checkout time', async ({
  page,
  hotel,
}) => {
  await openStays(page, hotel);

  const card = page.locator('div', { has: page.getByText('Stay settings') }).last();
  await card.getByLabel(/Checkout time/).fill('13:30');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Stay settings saved.')).toBeVisible();
});

test('13.3 AC4 — regenerate from the stay detail shows a new code once', async ({
  page,
  request,
  hotel,
  standardType,
}) => {
  const { checkInOk } = await import('../../helpers/stays');
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['484'], 15);
  const rooms = await roomsById(request, hotel.ownerToken);
  const { code } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['484'] });

  await openStays(page, hotel);
  await page.locator('table tbody tr', { hasText: '484' }).getByRole('button', { name: 'View' }).click();
  const detail = page.getByRole('dialog', { name: 'Stay details' });
  await expect(detail.getByText('Stay code')).toBeVisible();

  await detail.getByRole('button', { name: 'New code' }).click();
  const confirm = page.getByRole('dialog', { name: 'Generate a new stay code' });
  await confirm.getByRole('button', { name: 'Generate new code' }).click();
  await expect(confirm).toHaveCount(0);

  // The detail's stay-code card swaps the mask for the new code, shown once.
  const text = await detail.innerText();
  const newCode = text.match(/\b\d{6}\b/)?.[0];
  expect(newCode, 'new code displayed in the code card').toBeTruthy();
  expect(newCode).not.toBe(code);

  const oldSession = await guestSessionSteady(request, hotel.slug, '484', code);
  expect(oldSession.status).toBe(401);
  const newSession = await guestSessionSteady(request, hotel.slug, '484', newCode!);
  expect(newSession.status).toBe(200);
});
