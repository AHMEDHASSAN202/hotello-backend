/**
 * Epic 18 — Story 18.3 (upsell vs permission) and the Story 18.1 management
 * page in the Tenant Dashboard: live phone preview, contrast block +
 * suggestion, welcome editing, logo note, reset flow.
 * API surface: hotello-hotel-frontend `/t/{slug}/branding`; suites drive the
 * real UI at :3001.
 */
import { expect, test } from '../../fixtures';
import { TENANT_URL, createStaffUser } from '../../helpers/gxp-api';
import { uiSession } from '../../helpers/tenant-ui';
import { solidPng, brandHotel } from './helpers';
import type { Page } from '@playwright/test';

test.setTimeout(420_000);

const BRANDING_NAV = 'Guest App Branding';
const HONEST_UPGRADE_COPY = /Available on a higher plan/i;
const DEMO_WELCOME_EN = 'Welcome to the heart of Hurghada';

async function gotoBranding(page: Page, slug: string): Promise<void> {
  await page.goto(`${TENANT_URL}/t/${slug}/branding`);
}

test('18.3 AC1/AC2 — plan without the module: nav keeps Branding with an Upgrade badge (not "Soon"), page renders the upsell shell with sample branding, locked knobs, honest copy', async ({
  page,
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, 'up', { withModule: false });
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh, 'Rooms');

  // Nav: still visible (this module is BUILT), with the upgrade affordance.
  const brandingLink = page.getByRole('link', { name: new RegExp(`${BRANDING_NAV}`) });
  await expect(brandingLink).toBeVisible();
  await expect(brandingLink.getByTestId('nav-upgrade-badge')).toHaveText('Upgrade');
  await expect(brandingLink.getByTestId('nav-soon-badge')).toHaveCount(0);

  await gotoBranding(page, hotel.slug);
  // The reusable upsell shell + honest copy (no dark patterns, no countdowns).
  await expect(page.getByTestId('module-upsell-guest_app_branding')).toBeVisible();
  await expect(page.getByText(HONEST_UPGRADE_COPY)).toBeVisible();

  // Sample branding in a read-only phone preview: demo cover + demo welcome.
  await expect(page.getByTestId('phone-preview')).toBeVisible();
  await expect(page.getByTestId('preview-demo-cover')).toBeVisible();
  await expect(page.getByTestId('preview-welcome')).toHaveText(DEMO_WELCOME_EN);
  await expect(page.getByTestId('preview-greeting')).toBeVisible();

  // Controls visually present but locked (disabled inputs, no Save section).
  await expect(page.getByLabel('Hex value')).toBeDisabled();
  await expect(page.getByLabel('Welcome message (English)')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Save changes/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Reset all to defaults/i })).toHaveCount(0);
  // No network traffic backs the locked state (no saved values to load).
  await expect(page.getByText(/Reset color/i)).toBeDisabled();
});

test('18.3 AC3 — module in plan but no branding.manage permission: nav hides Branding entirely; direct URL hits the permission empty state', async ({
  page,
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, 'perm');
  const staff = await createStaffUser(request, hotel.ownerToken, hotel.slug, ['rooms.read']);
  await uiSession(page, hotel.slug, staff.token, staff.refreshToken, 'Rooms');

  // Permission-hidden: NOT even the upsell entry (upsell is strictly plan-gated).
  await expect(page.getByRole('link', { name: BRANDING_NAV })).toHaveCount(0);

  await gotoBranding(page, hotel.slug);
  await expect(page.getByText('No access to branding')).toBeVisible();
  await expect(page.getByText(/Manage branding/i)).toBeVisible();
});

test('18.3 AC3 — the guard matrix behind the UI: module-off → MODULE_NOT_ENABLED for the owner, permission-off → plain 403 for staff, no token → 401', async ({
  request,
  adminToken,
}) => {
  const { apiGet, apiPatch, apiPost } = await import('../../helpers/gxp-api');

  // No token at all.
  const anon = await apiGet(request, '/tenant/branding');
  expect(anon.status).toBe(401);

  // Plan-gated: owner (has branding.manage via *) but module not in plan.
  const locked = await brandHotel(request, adminToken, 'guard1', { withModule: false });
  const modOff = await apiGet(request, '/tenant/branding', locked.ownerToken);
  expect(modOff.status).toBe(403);
  expect((modOff.body as { code?: string }).code).toBe('MODULE_NOT_ENABLED');
  const patchOff = await apiPatch(request, '/tenant/branding', { brandAccentColor: '#7A3B8F' }, locked.ownerToken);
  expect(patchOff.status).toBe(403);
  const coverOff = await apiPost(request, '/tenant/branding/cover', {}, locked.ownerToken);
  expect(coverOff.status).toBe(403);

  // Permission-gated: module in plan, staff role without branding.manage.
  const open = await brandHotel(request, adminToken, 'guard2');
  const staff = await createStaffUser(request, open.ownerToken, open.slug, ['rooms.read']);
  const permOff = await apiGet(request, '/tenant/branding', staff.token);
  expect(permOff.status).toBe(403);
  expect((permOff.body as { code?: string }).code).toBeUndefined();
});

test('18.1 AC1–AC4 — management page with the module: live preview mirrors the knobs, contrast block + one-click suggestion, save, cover upload into the preview, logo note, reset-all with confirm', async ({
  page,
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, 'ui');
  await uiSession(page, hotel.slug, hotel.ownerToken, hotel.ownerRefresh, 'Rooms');
  await gotoBranding(page, hotel.slug);

  // 18.1 AC2 — the honest preview renders from the guest tokens.
  const preview = page.getByTestId('phone-preview');
  await expect(preview).toBeVisible();
  expect(await preview.getAttribute('dir')).toBe('ltr');
  await expect(page.getByTestId('preview-greeting')).toBeVisible();

  // 18.1 AC1 — typing an unreadable accent is blocked with a suggestion,
  // Save is disabled while blocked, and the suggestion applies in one click.
  const hex = page.getByLabel('Hex value');
  await hex.fill('#FFFF00');
  const alert = page.getByRole('alert').filter({ hasText: /too light/i });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/too light/i);
  const suggestion = page.getByTestId('accent-suggestion');
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText(/^Use #[0-9A-F]{6} instead$/);
  const save = page.getByRole('button', { name: /Save changes/i });
  await expect(save).toBeDisabled();
  await suggestion.click();
  await expect(hex).not.toHaveValue('#FFFF00');
  await expect(hex).toHaveValue(/^#[0-9A-F]{6}$/);

  // 18.1 AC2 — the welcome line re-renders in the preview as you type,
  // and the AR/EN switch flips the preview to RTL.
  const welcomeEn = page.getByLabel('Welcome message (English)');
  await welcomeEn.fill('Welcome to the heart of Hurghada');
  await expect(page.getByTestId('preview-welcome')).toHaveText('Welcome to the heart of Hurghada');
  const welcomeAr = page.getByLabel('Welcome message (Arabic)');
  await welcomeAr.fill('أهلاً بكم في قلب الغردقة');
  await page.getByRole('button', { name: 'AR', exact: true }).click();
  expect(await preview.getAttribute('dir')).toBe('rtl');
  await expect(page.getByTestId('preview-welcome')).toHaveText('أهلاً بكم في قلب الغردقة');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  expect(await preview.getAttribute('dir')).toBe('ltr');

  // The suggested (safe) accent saves.
  await save.click();
  await expect(page.getByRole('status')).toContainText(/Saved/);

  // 18.1 AC1 — cover upload flows through the shared PhotoPicker into the
  // preview (thumb rendition).
  await page.setInputFiles('input[type="file"]', {
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: solidPng(320, 180, [20, 90, 160]),
  });
  await expect(page.getByTestId('preview-cover')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Replace photo/i })).toBeVisible();

  // 18.1 AC4 — the logo is NOT duplicated here: a link to the hotel profile.
  const logoLink = page.getByRole('link', { name: /Manage it in Profile/i });
  await expect(logoLink).toBeVisible();
  expect(await logoLink.getAttribute('href')).toBe(`/t/${hotel.slug}/profile`);

  // 18.1 AC3 — reset-all is confirmed with a consequence note, then wipes
  // every knob (accent + welcome + cover).
  await page.getByRole('button', { name: /Reset all to defaults/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/defaults/i);
  await dialog.getByRole('button', { name: /Reset all to defaults/i }).click();
  await expect(page.getByTestId('preview-cover')).toHaveCount(0);
  await expect(page.getByTestId('preview-welcome')).toHaveCount(0);
  await expect(hex).toHaveValue('');

  // And the backend agrees: everything back to defaults.
  const { apiGet } = await import('../../helpers/gxp-api');
  const fresh = await apiGet<Record<string, unknown>>(request, '/tenant/branding', hotel.ownerToken);
  expect(fresh.status).toBe(200);
  expect(fresh.body.brandAccentColor).toBeNull();
  expect(fresh.body.welcomeMessage).toBeNull();
  expect(fresh.body.coverThumbUrl).toBeNull();
});
