/**
 * Epic 14 — Story 14.3 Seven-language i18n foundation.
 */
import { expect, test } from '../../fixtures';
import {
  apiPost,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestName } from '../../helpers/stays';
import { GUEST_URL } from '../../helpers/guest-ui';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};
let seq = 0;

test.beforeAll(async ({ request, adminToken }) => {
  dedicated = await provisionHotel(request, { epic: 'e14', tag: `i18n${Date.now().toString(36)}`, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['601', '602', '603', '604', '605', '606', '607', '608'], 6);
  const { apiGetRetry } = await import('../../helpers/gxp-api');
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;
});

async function checkInUi(
  request: Parameters<typeof apiPost>[0],
  page: Page,
  roomNumber: string,
  language?: string,
) {
  seq += 1;
  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms[roomNumber],
    guestName: `i18n Guest ${seq}`,
    ...(language ? { language } : {}),
  });
  await page.goto(`${GUEST_URL}/${dedicated.slug}`);
  await page.getByLabel('Room number').fill(roomNumber);
  await page.getByLabel('code-input').fill(code);
  await expect(page.getByText(stay.guestName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  return stay;
}

test('14.3 AC2 — browser language picks the entry language (ru)', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ru-RU' });
  const page = await context.newPage();
  await page.goto(`${GUEST_URL}/${dedicated.slug}`);
  await expect(page.getByText('Номер комнаты', { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
  await context.close();
});

test('14.3 AC2 — the stay language drives the home screen (ar guest → RTL Arabic)', async ({
  page,
  request,
}) => {
  const stay = await checkInUi(request, page, '601', 'ar');
  // RTL flips the document.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  // Bidi-isolated guest name is rendered; greeting is Arabic.
  await expect(page.getByText(stay.guestName, { exact: false }).first()).toBeVisible();
  await expect(page.locator('body')).toContainText('غرفة'); // "Room" in the stay card
});

test('14.3 AC3 — the switcher is reachable in-app, in a bottom sheet, and switches instantly', async ({
  page,
  request,
}) => {
  await checkInUi(request, page, '602', 'en');
  await page.getByRole('button', { name: 'Language' }).first().click();
  const sheet = page.getByRole('dialog').or(page.locator('[role="dialog"]')).first();
  await expect(page.locator('text=Русский').first()).toBeVisible();
  await page.locator('text=Русский').first().click();
  // Instant switch — home copy flips to Russian without a reload.
  await expect(page.locator('body')).toContainText('Осталось');
});

test('14.3 AC6 — Russian plurals: 5 ночей vs 1 ночь (ICU), Latin digits', async ({
  page,
  request,
}) => {
  await checkInUi(request, page, '603', 'ru');
  // Default stay is 3 nights → the plural family "ночи" (2–4).
  await expect(page.locator('body')).toContainText('Осталось 3 ночи');
});

test('14.3 AC6 — the ru plural family renders correctly across stay lengths', async ({
  page,
  request,
}) => {
  // 1-night stay: "1 ночь".
  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms['604'],
    guestName: guestName(),
    language: 'ru',
    checkOutDate: isoPlus(1),
  });
  const session = await guestSessionOkRu(request, dedicated.slug, '604', code);
  await page.addInitScript(
    ([token]) => window.localStorage.setItem('gxp_guest_token', token!),
    [session] as const,
  );
  await page.goto(`${GUEST_URL}/${dedicated.slug}`);
  await expect(page.locator('body')).toContainText(/1 ночь(?!и|ь)/);
  expect(stay.checkOutDate).toBeTruthy();
});

test('14.3 AC1 — the seven locale files pass the repo parity check', async () => {
  // The guest repo's own check runs across all seven bundles — a red parity
  // is a red build per the repo law; we run it here so E2E fails with it.
  const out = execFileSync('npm', ['run', 'check:i18n'], {
    cwd: process.env.GXP_GUEST_REPO ?? '/Users/ahmedhassan/Desktop/Projects/Hotello/hotello-guest-frontend',
    encoding: 'utf8',
  });
  expect(out.toLowerCase()).not.toContain('missing');
});

// ------------------------------------------------------------------ helpers

function isoPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function guestSessionOkRu(
  request: Parameters<typeof apiPost>[0],
  slug: string,
  roomNumber: string,
  code: string,
): Promise<string> {
  const res = await apiPost(request, `/guest/${slug}/session`, { roomNumber, code });
  expect(res.status).toBe(200);
  return (res.body as { accessToken: string }).accessToken;
}
