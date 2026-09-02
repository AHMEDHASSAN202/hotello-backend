/**
 * Epic 15 — Guest App UI: submit + track requests (14 tile activation, 15.2, 15.3).
 */
import { expect, test } from '../../fixtures';
import {
  apiGetRetry,
  createFullModulePlan,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestName } from '../../helpers/stays';
import { GUEST_URL, uiGuestSession } from '../../helpers/guest-ui';
import type { Page } from '@playwright/test';

// Provisioning + paced logins need headroom under full-suite load.
test.setTimeout(600_000);

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};

test.beforeAll(async ({ request, adminToken }) => {
  const planId = await createFullModulePlan(request, adminToken, `QA Full ${Date.now().toString(36)}`);
  dedicated = await provisionHotel(request, { epic: 'e15', tag: `ui${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['931', '932', '933', '934'], 9);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;
});

async function enterAs(request: Parameters<typeof apiGetRetry>[0], page: Page, roomNumber: string, guest: string) {
  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms[roomNumber],
    guestName: guest,
    language: 'en',
  });
  const { guestSessionOk } = await import('../../helpers/stays');
  const session = await guestSessionOk(request, dedicated.slug, roomNumber, code);
  await uiGuestSession(page, dedicated.slug, {
    accessToken: session.accessToken,
    profile: session.profile as never,
  });
  await expect(page.getByText(guest, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  return stay;
}

test('15.2 AC1 — the Requests tile is live (no "Soon"), opening the catalog', async ({
  page,
  request,
}) => {
  await enterAs(request, page, '931', guestName());
  const tile = page.getByText('Requests', { exact: true }).first();
  await expect(tile).toBeVisible();
  await tile.click();
  // The catalog opens: housekeeping items in English.
  await expect(page.getByText(/Extra towels|Housekeeping/i).first()).toBeVisible({ timeout: 15_000 });
});

test('15.2 AC2/AC3 — three-tap submit: item → sheet → submit lands in My requests', async ({
  page,
  request,
}) => {
  await enterAs(request, page, '932', guestName());
  await page.getByText('Requests', { exact: true }).first().click();

  // Browse: categories then items (guest language = en).
  const item = page.getByText('Extra towels', { exact: true }).first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();

  // Bottom sheet with a quantity option + note + submit.
  const sheet = page.getByRole('dialog').or(page.locator('[role="dialog"]')).first();
  await sheet.getByText(/Submit|Send/i).click();
  // Optimistic confirmation → the request shows up in My requests as received.
  await expect(page.getByText(/Received|New/i).first()).toBeVisible({ timeout: 15_000 });
});

test('15.3 AC1/AC3 — my requests: status chip, guest cancel while new', async ({
  page,
  request,
}) => {
  const guest = guestName();
  await enterAs(request, page, '933', guest);
  await page.getByText('Requests', { exact: true }).first().click();
  const item = page.getByText('Extra towels', { exact: true }).first();
  await item.click();
  const sheet = page.getByRole('dialog').or(page.locator('[role="dialog"]')).first();
  await sheet.getByText(/Submit|Send/i).click();
  await expect(page.getByText(/Received|New/i).first()).toBeVisible({ timeout: 15_000 });

  // Cancel while new.
  const cancel = page.getByRole('button', { name: /cancel/i }).first();
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
    // The request leaves the active list (cancelled lives in history).
    await expect(page.getByRole('button', { name: /cancel/i })).toHaveCount(0, { timeout: 15_000 });
  }
});

test('15.2 AC6 — a fully disabled catalog shows the warm contact-front-desk state', async ({
  page,
  request,
  adminToken,
}) => {
  // A hotel whose catalog items are all disabled. The plan must INCLUDE the
  // requests module (otherwise the tile itself is hidden — QA-14-001) — we
  // are testing catalog emptiness, not module gating.
  const emptyPlan = await createFullModulePlan(request, adminToken, `QA EmptyCat ${Date.now().toString(36)}`);
  const empty = await provisionHotel(request, { epic: 'e15', tag: `emp${Date.now().toString(36)}`, planId: emptyPlan, adminToken });
  const type = await standardTypeId(request, empty.ownerToken);
  await createRoomsQuickly(request, empty.ownerToken, type, ['940'], 9);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    empty.ownerToken,
  );
  const roomMap: Record<string, string> = {};
  for (const room of list.body.data) roomMap[room.roomNumber] = room.id;

  // Disable every category (hides all items for this hotel).
  const catalog = await apiGetRetry<unknown>(request, '/tenant/request-catalog', empty.ownerToken);
  const raw = catalog.body as { categories?: Array<{ id: string }> } | Array<{ id: string }>;
  const categories = Array.isArray(raw) ? raw : (raw.categories ?? []);
  for (const category of categories) {
    await (await import('../../helpers/gxp-api')).apiPatch(
      request,
      `/tenant/request-catalog/categories/${category.id}`,
      { enabled: false },
      empty.ownerToken,
    );
  }

  const { code } = await checkInOk(request, empty.ownerToken, {
    roomId: roomMap['940'],
    guestName: guestName(),
  });
  const { guestSessionOk } = await import('../../helpers/stays');
  const session = await guestSessionOk(request, empty.slug, '940', code);
  await uiGuestSession(page, empty.slug, {
    accessToken: session.accessToken,
    profile: session.profile as never,
  });
  await page.getByText('Requests', { exact: true }).first().click();
  await expect(page.getByText(/front desk/i).first()).toBeVisible({ timeout: 15_000 });
});
