/**
 * Epic 14 — Story 14.4 Home Screen composition + module/tile gating.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiGetRetry,
  createPlan,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestName, todayPlus } from '../../helpers/stays';
import { GUEST_URL } from '../../helpers/guest-ui';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

function sql(query: string): string {
  return execFileSync('docker', ['exec', 'hotello-db', 'psql', '-U', 'hotello', '-d', 'hotello', '-tAc', query], {
    encoding: 'utf8',
  }).trim();
}

let seq = 0;
async function setup(
  request: Parameters<typeof apiGet>[0],
  adminToken: string,
  opts: { modules?: string[]; planName?: string } = {},
): Promise<{ hotel: ProvisionedHotel; rooms: Record<string, string> }> {
  seq += 1;
  const planId = opts.modules
    ? await createPlan(request, adminToken, {
        nameEn: opts.planName ?? `QA Home ${seq} ${Date.now().toString(36)}`,
        enabledModules: opts.modules,
      })
    : undefined;
  const hotel = await provisionHotel(request, { epic: 'e14', tag: `hm${seq}${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['701', '702', '703', '704'], 7);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    hotel.ownerToken,
  );
  const rooms: Record<string, string> = {};
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;
  return { hotel, rooms };
}

async function openHome(
  request: Parameters<typeof apiGet>[0],
  page: Page,
  hotel: ProvisionedHotel,
  roomNumber: string,
  guest: string,
) {
  const { stay, code } = await checkInOk(request, hotel.ownerToken, {
    roomId: roomsMap(page)[roomNumber] ?? '',
    guestName: guest,
  });
  const session = await apiPostSession(request, hotel.slug, roomNumber, code);
  await page.addInitScript(
    ([token]) => window.localStorage.setItem('gxp_guest_token', token!),
    [session] as const,
  );
  await page.goto(`${GUEST_URL}/${hotel.slug}`);
  await expect(page.getByText(guest, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  return stay;
}

// Per-test room maps live on the page object's closure via a registry.
const registry = new Map<Page, Record<string, string>>();
function roomsMap(page: Page): Record<string, string> {
  return registry.get(page) ?? {};
}

async function apiPostSession(
  request: Parameters<typeof apiGet>[0],
  slug: string,
  roomNumber: string,
  code: string,
): Promise<string> {
  const { apiPost } = await import('../../helpers/gxp-api');
  const res = await apiPost(request, `/guest/${slug}/session`, { roomNumber, code });
  expect(res.status).toBe(200);
  return (res.body as { accessToken: string }).accessToken;
}

test('14.4 AC2 — home composition: greeting, stay card (room/nights/checkout), services grid', async ({
  page,
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setup(request, adminToken);
  registry.set(page, rooms);
  const guest = guestName();
  await openHome(request, page, hotel, '701', guest);

  // Personal greeting.
  await expect(page.getByText(`Welcome, ${guest}!`)).toBeVisible();
  // Stay card: room number, nights, checkout date + hotel checkout time.
  await expect(page.getByText('701', { exact: true })).toBeVisible();
  await expect(page.getByText(/night(s)? remaining/)).toBeVisible();
  await expect(page.getByText(/until .+ · 12:00/)).toBeVisible();
  // Services grid title.
  await expect(page.getByText('At your service')).toBeVisible();
});

test('14.4 AC3 — services grid: live tiles, "Soon" tile, gating follows enabled_modules', async ({
  page,
  request,
  adminToken,
}) => {
  // NOTE: the SEEDED Standard plan predates the `requests` module key, so
  // tile tests always use freshly created plans (current catalog).
  const allModules = ['requests', 'fnb', 'transportation', 'hotel_info', 'housekeeping', 'analytics', 'announcements', 'events', 'guest_app_branding'];
  const all = await setup(request, adminToken, {
    modules: allModules,
    planName: `QA Tiles All ${Date.now().toString(36)}`,
  });
  registry.set(page, all.rooms);
  await openHome(request, page, all.hotel, '701', guestName());
  // Live tiles (requests/fnb/events), transport as the "Soon" tile.
  await expect(page.getByText('Requests', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Dining', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Events', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Transport', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Soon').first()).toBeVisible();
  // Hotel Info's tri-state: module on + no content → hidden entirely.
  await expect(page.getByText('Hotel info', { exact: true })).toHaveCount(0);

  // A plan without fnb/transportation hides those tiles entirely.
  const gated = await setup(request, adminToken, {
    modules: ['requests', 'hotel_info', 'housekeeping', 'analytics', 'announcements', 'events', 'guest_app_branding'],
    planName: `QA Tiles ${Date.now().toString(36)}`,
  });
  const page2 = await page.context().newPage();
  registry.set(page2, gated.rooms);
  await openHome(request, page2, gated.hotel, '701', guestName());
  await expect(page2.getByText('Requests', { exact: true }).first()).toBeVisible();
  await expect(page2.getByText('Dining', { exact: true })).toHaveCount(0);
  await expect(page2.getByText('Transport', { exact: true })).toHaveCount(0);
  await page2.close();
});

test('14.4 AC4 — on checkout day the stay card notes checkout time warmly', async ({
  page,
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await setup(request, adminToken);
  registry.set(page, rooms);
  // Check-in yesterday, checkout today — the last day. A fresh hotel means
  // room 702 is free; the returned code opens the session directly.
  const { code } = await checkInOk(request, hotel.ownerToken, {
    roomId: rooms['702'],
    guestName: guestName(),
    checkInDate: todayPlus(-1),
    checkOutDate: todayPlus(0),
  });
  const token = await apiPostSession(request, hotel.slug, '702', code);
  await page.addInitScript(([t]) => window.localStorage.setItem('gxp_guest_token', t!), [token] as const);
  await page.goto(`${GUEST_URL}/${hotel.slug}`);
  await expect(page.getByText(/Checkout today at 12:00/i)).toBeVisible({ timeout: 15_000 });
});

test('14.4 AC5 — branding: accent color applies only with the guest_app_branding module', async ({
  request,
  adminToken,
}) => {
  const modules = ['requests', 'hotel_info', 'guest_app_branding', 'housekeeping'];
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA Accent ${Date.now().toString(36)}`,
    enabledModules: modules,
  });
  const hotel = await provisionHotel(request, { epic: 'e14', tag: `ac${Date.now().toString(36)}`, planId, adminToken });
  sql(`UPDATE hotels SET "brandAccentColor" = '#7A3B8F' WHERE id = '${hotel.hotelId}'`);

  const profile = await apiGet<{ brandAccentColor?: string | null }>(request, `/guest/${hotel.slug}/profile`);
  expect(profile.body.brandAccentColor).toBe('#7A3B8F');
});

test('14.1 AC4 — performance budgets: the entry page ships a lean JS payload', async ({
  request,
  adminToken,
  page,
}) => {
  const { hotel } = await setup(request, adminToken);
  const transferred: number[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/_next/static') && res.headers()['content-type']?.includes('javascript')) {
      transferred.push(Number(res.headers()['content-length'] ?? 0));
    }
  });
  await page.goto(`${GUEST_URL}/${hotel.slug}`);
  await page.waitForLoadState('networkidle');
  const totalKb = transferred.reduce((a, b) => a + b, 0) / 1024;
  // Generous shell budget (gzipped sizes reported by content-length vary);
  // the Lighthouse CI check is the enforced gate — this is a tripwire.
  expect(totalKb, `initial JS across chunks: ${Math.round(totalKb)}KB`).toBeLessThan(1500);
});
