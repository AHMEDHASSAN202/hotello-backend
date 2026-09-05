/**
 * Epic 14 — Story 14.1 Foundation/PWA + 14.4 AC1 (public profile endpoint).
 * API-level: the app's data contract; visual states live in 14-5.
 */
import { expect, test } from '../../fixtures';
import { apiGet, apiPatch, createPlan, provisionHotel } from '../../helpers/gxp-api';
import { GUEST_URL } from '../../helpers/guest-ui';
import { execFileSync } from 'node:child_process';

// Paced logins queue under full-suite load; give provisioning headroom.
test.setTimeout(420_000);

function sql(query: string): string {
  return execFileSync('docker', ['exec', 'gxp-db', 'psql', '-U', 'gxp', '-d', 'gxp', '-tAc', query], {
    encoding: 'utf8',
  }).trim();
}

test('14.4 AC1 — the public profile endpoint returns guest-safe branding basics', async ({
  request,
  adminToken,
}) => {
  const hotel = await provisionHotel(request, { epic: 'e14', tag: `pf${Date.now().toString(36)}`, adminToken });
  const res = await apiGet(request, `/guest/${hotel.slug}/profile`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  expect(body).toMatchObject({
    slug: hotel.slug,
    nameEn: expect.any(String),
    nameAr: expect.any(String),
    status: 'active',
    checkoutTime: '12:00',
  });
  expect(Array.isArray(body.enabledModules)).toBe(true);
  // Guest-appropriate only: no internal machinery leaks.
  const raw = JSON.stringify(body);
  for (const forbidden of ['password', 'subscription', 'trial', 'owner']) {
    expect(raw.toLowerCase()).not.toContain(forbidden);
  }
});

test('14.4 AC1 — unknown slug → 404 HOTEL_NOT_FOUND', async ({ request }) => {
  const res = await apiGet(request, '/guest/qa-no-such-hotel/profile');
  expect(res.status).toBe(404);
  expect((res.body as { code?: string }).code).toBe('HOTEL_NOT_FOUND');
});

test('14.1 AC5/14.4 AC1 — suspended and expired-trial collapse to status unavailable', async ({
  request,
  adminToken,
}) => {
  const suspended = await provisionHotel(request, { epic: 'e14', tag: `sus${Date.now().toString(36)}`, adminToken });
  const sup = await apiPatch(request, `/hotels/${suspended.hotelId}/suspend`, { reason: 'hotel_request' }, adminToken);
  expect(sup.status).toBe(200);

  const res = await apiGet(request, `/guest/${suspended.slug}/profile`);
  expect(res.status).toBe(200);
  expect((res.body as { status?: string }).status).toBe('unavailable');

  // Expired trial: move the subscription's trial end into the past (data-level
  // setup for an edge only time can produce normally).
  const expired = await provisionHotel(request, { epic: 'e14', tag: `exp${Date.now().toString(36)}`, adminToken });
  // Only one active trial plan may exist platform-wide — reuse the seeded one.
  const plans = await apiGet<Array<{ id: string; nameEn: string }>>(request, '/plans', adminToken);
  const trialPlan = plans.body.find((p) => p.nameEn === 'Free Trial')!.id;
  const change = await apiPatch(request, `/hotels/${expired.hotelId}/subscription`, {
    planId: trialPlan,
    billingCycle: 'monthly',
  }, adminToken);
  expect(change.status).toBe(200);
  // Mirror exactly what the trial-expiry job writes when a trial lapses.
  sql(`UPDATE subscriptions SET status = 'expired', "trialEndsAt" = NOW() - INTERVAL '1 day' WHERE "hotelId" = '${expired.hotelId}' AND "endDate" IS NULL`);

  // TenantAccessService caches hotel state for 10s — the provisioning logins
  // just cached "active"; wait out the window before judging the profile.
  await new Promise((r) => setTimeout(r, 12_000));
  const res2 = await apiGet(request, `/guest/${expired.slug}/profile`);
  expect(res2.status).toBe(200);
  expect((res2.body as { status?: string }).status).toBe('unavailable');
});

test('14.4 AC5 — brandAccentColor is gated server-side by guest_app_branding', async ({
  request,
  adminToken,
}) => {
  const modules = ['transportation', 'housekeeping', 'fnb', 'analytics', 'requests', 'hotel_info', 'announcements', 'events'];

  // Hotel A: no branding module. The column is set before the first profile
  // fetch (the endpoint caches per slug for 60s) — the response must hide it.
  const noBrandPlan = await createPlan(request, adminToken, {
    nameEn: `QA NoBrand ${Date.now().toString(36)}`,
    enabledModules: modules,
  });
  const hotelA = await provisionHotel(request, { epic: 'e14', tag: `nb${Date.now().toString(36)}`, planId: noBrandPlan, adminToken });
  sql(`UPDATE hotels SET "brandAccentColor" = '#AA3366' WHERE id = '${hotelA.hotelId}'`);
  const gated = await apiGet<{ brandAccentColor?: string | null }>(request, `/guest/${hotelA.slug}/profile`);
  expect(gated.body.brandAccentColor ?? null).toBeNull();

  // Hotel B: with the module, same column value — the app sees the color.
  const brandPlan = await createPlan(request, adminToken, {
    nameEn: `QA Brand ${Date.now().toString(36)}`,
    enabledModules: [...modules, 'guest_app_branding'],
  });
  const hotelB = await provisionHotel(request, { epic: 'e14', tag: `wb${Date.now().toString(36)}`, planId: brandPlan, adminToken });
  sql(`UPDATE hotels SET "brandAccentColor" = '#AA3366' WHERE id = '${hotelB.hotelId}'`);
  const open = await apiGet<{ brandAccentColor?: string | null }>(request, `/guest/${hotelB.slug}/profile`);
  expect(open.body.brandAccentColor).toBe('#AA3366');
});

test('14.1 AC2 — PWA manifest: per-hotel name, standalone, icons, viewport-fit', async ({
  request,
  adminToken,
  page,
}) => {
  const hotel = await provisionHotel(request, { epic: 'e14', tag: `pw${Date.now().toString(36)}`, adminToken });
  const res = await page.request.get(`${GUEST_URL}/${hotel.slug}/manifest.webmanifest`);
  expect(res.status()).toBe(200);
  const manifest = (await res.json()) as Record<string, unknown>;
  expect(manifest.display).toBe('standalone');
  expect((manifest.name as string)?.length).toBeGreaterThan(0);
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect((manifest.icons as Array<unknown>).length).toBeGreaterThan(0);

  // viewport-fit=cover + theme-color on the page itself.
  await page.goto(`${GUEST_URL}/${hotel.slug}`);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport ?? '').toContain('viewport-fit=cover');
  expect(await page.locator('meta[name="theme-color"]').count()).toBeGreaterThan(0);
});

test('14.1 AC3 — the service worker asset and offline fallback are served', async ({
  request,
  adminToken,
  page,
}) => {
  const hotel = await provisionHotel(request, { epic: 'e14', tag: `sw${Date.now().toString(36)}`, adminToken });
  await page.goto(`${GUEST_URL}/${hotel.slug}`);

  // sw.js served at the root; the offline fallback ships as an asset.
  const sw = await page.request.get(`${GUEST_URL}/sw.js`);
  expect(sw.status()).toBe(200);
  expect((await sw.text())).toContain('install');

  const offline = await page.request.get(`${GUEST_URL}/offline.html`);
  expect(offline.status()).toBe(200);

  // Registration itself is production-only by design (dev skips it so stale
  // caches never fight fast refresh) — asserted in the report, not here.
});
