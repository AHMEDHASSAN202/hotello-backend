/**
 * Epic 14 — Story 14.2 Entry & Session Flow (UI).
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPost,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestName, guestSessionSteady } from '../../helpers/stays';
import { GUEST_URL } from '../../helpers/guest-ui';
import type { Page } from '@playwright/test';

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};

test.beforeAll(async ({ request, adminToken }) => {
  dedicated = await provisionHotel(request, { epic: 'e14', tag: `en${Date.now().toString(36)}`, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['301', '302', '303', '304', '305', '306'], 3);
  const list = await apiGetRooms(request, dedicated.ownerToken);
  rooms = list;
});

async function apiGetRooms(
  request: Parameters<typeof apiPost>[0],
  token: string,
): Promise<Record<string, string>> {
  const { apiGetRetry } = await import('../../helpers/gxp-api');
  const res = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    token,
  );
  const map: Record<string, string> = {};
  for (const room of res.body.data) map[room.roomNumber] = room.id;
  return map;
}
void apiGet;

async function openEntry(page: Page, query = '') {
  await page.goto(`${GUEST_URL}/${dedicated.slug}${query}`);
  await expect(page.getByLabel('entry-form')).toBeVisible();
}

test('14.2 AC1 — /{slug} shows room + code inputs; ?room= pre-fills and locks the room', async ({
  page,
}) => {
  await openEntry(page);
  const room = page.getByLabel('Room number');
  const code = page.getByLabel('code-input');
  await expect(room).toBeVisible();
  await expect(room).toHaveValue('');
  await expect(code).toBeVisible();

  // Room QR flow: room locked as a chip, code input only.
  await page.goto(`${GUEST_URL}/${dedicated.slug}?room=304`);
  await expect(page.getByText('Room number', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('304').first()).toBeVisible();
  await expect(page.getByLabel('Room number')).toHaveCount(0); // no editable room field
  await expect(page.getByLabel('code-input')).toBeVisible();
});

test('14.2 AC2 — segmented code input auto-submits on the 6th digit and enters the app', async ({
  page,
  request,
}) => {
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['301'], guestName: guestName() });

  await openEntry(page);
  await page.getByLabel('Room number').fill('301');
  await page.getByLabel('code-input').fill(code);

  // Auto-submitted on the 6th digit → home screen greets the guest.
  await expect(page.getByText(/Welcome,|Bienvenue|Willkommen|Добро пожаловать|أهلاً|Bienvenido|Benvenuto/i)).toBeVisible({
    timeout: 15_000,
  });
});

test('14.2 AC2 — paste-friendly: pasting 6 digits submits', async ({ page, request }) => {
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['302'], guestName: guestName() });

  await openEntry(page);
  await page.getByLabel('Room number').fill('302');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, code);
  const input = page.getByLabel('code-input');
  await input.click();
  await input.press('ControlOrMeta+v');
  // Paste fills all six boxes → auto-submit → home.
  await expect(page.getByText(/Welcome,|Bienvenue|Willkommen|Добро пожаловать|أهلاً|Bienvenido|Benvenuto/i)).toBeVisible({
    timeout: 15_000,
  });
});

test('14.2 AC3 — wrong code: inline error, no navigation, room field kept', async ({ page, request }) => {
  await checkInOk(request, dedicated.ownerToken, { roomId: rooms['303'], guestName: guestName() });

  await openEntry(page);
  await page.getByLabel('Room number').fill('303');
  await page.getByLabel('code-input').fill('000000');

  await expect(page.getByText(/doesn't match/i)).toBeVisible({ timeout: 15_000 });
  // Still on the entry screen with the room intact.
  await expect(page.getByLabel('entry-form')).toBeVisible();
  await expect(page.getByLabel('Room number')).toHaveValue('303');
});

test('14.2 AC4 — a valid session boots straight into the app; reloads persist', async ({
  page,
  request,
}) => {
  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms['304'],
    guestName: guestName(),
  });
  // Enter once via the form.
  await openEntry(page);
  await page.getByLabel('Room number').fill('304');
  await page.getByLabel('code-input').fill(code);
  await expect(page.getByText('Welcome,', { exact: false })).toBeVisible({ timeout: 15_000 });

  // Reload → token probes → straight home (no entry form flash), params ignored.
  await page.goto(`${GUEST_URL}/${dedicated.slug}?room=999`);
  await expect(page.getByLabel('entry-form')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(stay.guestName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});

test('14.2 AC5 — checkout mid-use routes to the warm goodbye with the entry beneath', async ({
  page,
  request,
}) => {
  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms['305'],
    guestName: guestName(),
  });
  // Enter via the seeded token path.
  const session = await guestSessionSteady(request, dedicated.slug, '305', code);
  const token = (session.body as unknown as { accessToken: string }).accessToken;
  await page.addInitScript(
    ([t]) => window.localStorage.setItem('gxp_guest_token', t!),
    [token] as const,
  );
  await page.goto(`${GUEST_URL}/${dedicated.slug}`);
  await expect(page.getByText(stay.guestName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Front desk checks the guest out from behind the scenes.
  const { apiGet: apiGetFn } = await import('../../helpers/gxp-api');
  const stays = await apiGetFn<{ data: Array<{ id: string; guestName: string }> }>(
    request,
    '/tenant/stays',
    dedicated.ownerToken,
  );
  const target = stays.body.data.find((s) => s.guestName === stay.guestName)!;
  const checkout = await apiPost(request, `/tenant/stays/${target.id}/checkout`, {}, dedicated.ownerToken);
  expect(checkout.status).toBe(200);

  // The app's own background traffic (announcements poll) hits the dead
  // session → the warm goodbye renders without any user action (AC5: any 401
  // mid-use routes here; a boot 401 would go silently to entry instead).
  await expect(page.getByRole('heading', { name: /This stay has ended/i })).toBeVisible({
    timeout: 65_000,
  });
  // The entry form is offered beneath the goodbye copy.
  await expect(page.getByLabel('entry-form')).toBeVisible();
});

test('14.2 AC6 — the same code opens a second browser context (multi-device)', async ({
  browser,
  request,
}) => {
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['306'], guestName: guestName() });

  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  for (const ctx of [ctx1, ctx2]) {
    const page = await ctx.newPage();
    await page.goto(`${GUEST_URL}/${dedicated.slug}`);
    await page.getByLabel('Room number').fill('306');
    await page.getByLabel('code-input').fill(code);
    await expect(page.getByText(/Welcome,|Bienvenue|Willkommen|Добро пожаловать|أهلاً|Bienvenido|Benvenuto/i)).toBeVisible({
      timeout: 15_000,
    });
    await ctx.close();
  }
});
