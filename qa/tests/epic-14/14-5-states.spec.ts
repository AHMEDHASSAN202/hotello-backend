/**
 * Epic 14 — Story 14.6 guest-facing state screens + 14.5 app-feel spot checks.
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

// Provisioning + paced logins + countdown waits need headroom.
test.setTimeout(420_000);

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};

test.beforeAll(async ({ request, adminToken }) => {
  dedicated = await provisionHotel(request, { epic: 'e14', tag: `st${Date.now().toString(36)}`, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['801', '802', '803', '804'], 8);
  const { apiGetRetry } = await import('../../helpers/gxp-api');
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;
});

test('14.1 AC5/14.6 AC1 — unknown slug: branded "Hotel not found", guest-appropriate copy', async ({
  page,
}) => {
  await page.goto(`${GUEST_URL}/qa-no-such-hotel`);
  await expect(page.getByText('Hotel not found', { exact: false })).toBeVisible();
  await expect(page.getByText('front desk', { exact: false }).first()).toBeVisible();
});

test('14.1 AC5/14.6 AC2 — suspended hotel: unavailable screen, no internal concepts', async ({
  page,
  request,
  adminToken,
}) => {
  const victim = await provisionHotel(request, { epic: 'e14', tag: `uns${Date.now().toString(36)}`, adminToken });
  const { apiPatch } = await import('../../helpers/gxp-api');
  const sup = await apiPatch(request, `/hotels/${victim.hotelId}/suspend`, { reason: 'policy_violation' }, adminToken);
  expect(sup.status).toBe(200);

  await page.goto(`${GUEST_URL}/${victim.slug}`);
  await expect(page.getByText('Temporarily unavailable', { exact: false })).toBeVisible();
  await expect(page.getByText('contact the front desk', { exact: false }).first()).toBeVisible();

  // Tone rule (14.6 AC2): the guest never sees internal machinery.
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['suspended', 'subscription', 'trial', 'tenant', '401']) {
    expect(body, `must not mention "${word}"`).not.toContain(word);
  }
});

test('14.6 AC1 — rate-limited screen shows the live retry countdown', async ({
  page,
  browser,
  request,
}) => {
  // Burn the per-room budget (5 failures → lockout). Each 6-digit fill
  // auto-submits; attempts 1–5 answer INVALID_CODE, attempt 6 hits the
  // lockout and the UI switches to the countdown screen.
  await checkInOk(request, dedicated.ownerToken, { roomId: rooms['801'], guestName: guestName() });
  await page.goto(`${GUEST_URL}/${dedicated.slug}`);
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('Room number').fill('801');
    await page.getByLabel('code-input').fill('000000');
    await expect(page.getByText(/doesn't match/i)).toBeVisible({ timeout: 15_000 });
  }
  await page.getByLabel('code-input').fill('000000');
  await expect(page.getByText(/Too many tries|paused/i).first()).toBeVisible({ timeout: 15_000 });
  // Live countdown, MM:SS, wired as a timer.
  const timer = page.locator('[role="timer"]');
  await expect(timer).toContainText(/\d{2}:\d{2}/);
});

// NOTE: the offline fallback screen is delivered by the service worker,
// which dev-mode deliberately does not register — the offline E2E is
// production-only. The SW + offline.html assets are asserted in 14-1.

// The mid-use goodbye (checkout while the app is open) is covered in
// 14-2-entry-session (AC5). Here: the BOOT-401 branch — a stale token after a
// past stay routes SILENTLY to entry, never a goodbye, never an error.
test('14.2 AC4/AC5 — a stale token boots silently to entry (no goodbye, no error)', async ({
  page,
  request,
}) => {
  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms['803'],
    guestName: guestName(),
  });
  const { apiGet: get } = await import('../../helpers/gxp-api');
  const stays = await get<{ data: Array<{ id: string; guestName: string }> }>(
    request,
    '/tenant/stays',
    dedicated.ownerToken,
  );
  const target = stays.body.data.find((s) => s.guestName === stay.guestName)!;
  await apiPost(request, `/tenant/stays/${target.id}/checkout`, {}, dedicated.ownerToken);

  // A token minted while the stay was alive is now dead: the boot probe 401s
  // and the app must land on the entry form with no goodbye copy and no red.
  await page.goto(`${GUEST_URL}/${dedicated.slug}`);
  await expect(page.getByLabel('entry-form')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/This stay has ended/i)).toHaveCount(0);
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).not.toContain('401');
});

test('14.5 AC3 — primary entry controls meet the 44px touch target floor', async ({
  page,
}) => {
  await page.goto(`${GUEST_URL}/${dedicated.slug}`);
  await page.getByLabel('entry-form').waitFor();

  // The entry flow has no submit button — it is OTP-style (auto-submit on
  // the 6th digit). Touch targets: room input, code boxes, language pill.
  const roomBox = await page.getByLabel('Room number').boundingBox();
  expect(roomBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  const codeBox = await page.getByLabel('code-input').boundingBox();
  expect(codeBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  const lang = await page.getByRole('button', { name: 'Language' }).boundingBox();
  expect(lang?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(lang?.width ?? 0).toBeGreaterThanOrEqual(44);
});

test('14.5 AC1 — app-feel: no text selection on UI chrome, overscroll tuned', async ({
  page,
}) => {
  await page.goto(`${GUEST_URL}/${dedicated.slug}`);
  await page.getByLabel('entry-form').waitFor();

  // Labels/headings behave like chrome, not text.
  const select = await page
    .locator('button')
    .first()
    .evaluate((el) => getComputedStyle(el).userSelect);
  expect(['none', '-moz-none']).toContain(select);

  const overscroll = await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY);
  expect(['none', 'contain']).toContain(overscroll);
});
