/**
 * Epic 18 — Story 18.2 AC1/AC3 at the API level: the public guest profile
 * carries coverImageUrl + welcomeMessage beside brandAccentColor, all gated
 * server-side by the guest_app_branding module; stored values persist while
 * gated and re-apply when the module returns. Fresh hotel per scenario —
 * the profile caches 60s per slug (the ONE documented wait is that TTL).
 */
import { expect, test } from '../../fixtures';
import { apiGet, apiPatch, createPlan } from '../../helpers/gxp-api';
import { sql } from '../../helpers/db';
import {
  brandHotel,
  getBranding,
  moduleList,
  patchBranding,
  solidPng,
  uploadCover,
} from './helpers';

test.setTimeout(420_000);

interface GuestProfile {
  slug: string;
  brandAccentColor: string | null;
  coverImageUrl: string | null;
  welcomeMessage: Record<string, string> | null;
  enabledModules: string[];
}

test('18.2 AC1 — without the module the profile returns defaults REGARDLESS of stored values (data retained for re-enable)', async ({
  request,
  adminToken,
}) => {
  // Data-level seeding: the branding API itself is module-gated, so a
  // no-module hotel with stored branding can only be produced via SQL —
  // the established pattern (14-1).
  const hotel = await brandHotel(request, adminToken, 'gated', { withModule: false });
  sql(
    `UPDATE hotels SET "brandAccentColor" = '#AA3366',
       "welcomeMessage" = '{"ar":"أهلاً","en":"Welcome"}'::jsonb,
       "coverImageDetailKey" = 'branding/${hotel.hotelId}/seeded-detail.webp',
       "coverImageThumbKey" = 'branding/${hotel.hotelId}/seeded-thumb.webp'
     WHERE id = '${hotel.hotelId}'`,
  );

  const res = await apiGet<GuestProfile>(request, `/guest/${hotel.slug}/profile`);
  expect(res.status).toBe(200);
  expect(res.body.slug).toBe(hotel.slug);
  // Gated: the stored values never leak to guests.
  expect(res.body.brandAccentColor).toBeNull();
  expect(res.body.coverImageUrl).toBeNull();
  expect(res.body.welcomeMessage).toBeNull();
});

test('18.2 AC1 — with the module the profile exposes accent, cover (detail rendition) and the whole welcome map, exactly as saved via the API', async ({
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, 'open');
  const set = await patchBranding(request, hotel.ownerToken, {
    brandAccentColor: '#7A3B8F',
    welcomeAr: 'أهلاً بكم في قلب الغردقة',
    welcomeEn: 'Welcome to the heart of Hurghada',
    welcomeRu: 'Добро пожаловать',
  });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  const up = await uploadCover(request, hotel.ownerToken, {
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: solidPng(),
  });
  expect(up.status).toBe(200);
  const view = await getBranding(request, hotel.ownerToken);

  const res = await apiGet<GuestProfile>(request, `/guest/${hotel.slug}/profile`);
  expect(res.status).toBe(200);
  expect(res.body.brandAccentColor).toBe('#7A3B8F');
  // Only the DETAIL rendition ships to guests, as files/{key}.
  expect(res.body.coverImageUrl).toBe(view.body.coverDetailUrl);
  expect(res.body.coverImageUrl).toMatch(new RegExp(`^files/branding/${hotel.hotelId}/.+\\.webp$`));
  // The map ships whole (cached per slug → the client localizes), not pre-resolved.
  expect(res.body.welcomeMessage).toEqual({
    ar: 'أهلاً بكم في قلب الغردقة',
    en: 'Welcome to the heart of Hurghada',
    ru: 'Добро пожаловать',
  });
});

test('18.2 AC1 — turning the module off un-applies branding, keeps the data, and re-enable re-applies it (documented waits: the 60s profile cache TTL, twice)', async ({
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, 'swap');
  await patchBranding(request, hotel.ownerToken, {
    brandAccentColor: '#7A3B8F',
    welcomeAr: 'أهلاً',
    welcomeEn: 'Welcome',
  });
  const up = await uploadCover(request, hotel.ownerToken, {
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: solidPng(),
  });
  expect(up.status).toBe(200);

  const branded = await apiGet<GuestProfile>(request, `/guest/${hotel.slug}/profile`);
  expect(branded.body.brandAccentColor).toBe('#7A3B8F');
  expect(branded.body.coverImageUrl).toBeTruthy();

  // Swap to a plan WITHOUT the module.
  const noBrandPlan = await createPlan(request, adminToken, {
    nameEn: `QA e18 off ${Date.now().toString(36)}`,
    enabledModules: await moduleList(request, adminToken, false),
  });
  const swapOff = await apiPatch(request, `/hotels/${hotel.hotelId}/subscription`, {
    planId: noBrandPlan,
    billingCycle: 'monthly',
  }, adminToken);
  expect(swapOff.status, JSON.stringify(swapOff.body)).toBe(200);

  // The profile caches per slug for 60s — wait out the documented TTL before
  // judging the post-swap response (the only sleep in this suite).
  await new Promise((r) => setTimeout(r, 65_000));
  const gated = await apiGet<GuestProfile>(request, `/guest/${hotel.slug}/profile`);
  expect(gated.body.brandAccentColor).toBeNull();
  expect(gated.body.coverImageUrl).toBeNull();
  expect(gated.body.welcomeMessage).toBeNull();

  // Values are RETAINED at rest, ready for re-enable.
  const row = sql(
    `SELECT "brandAccentColor", "welcomeMessage"::text, "coverImageDetailKey" FROM hotels WHERE id = '${hotel.hotelId}'`,
  );
  expect(row).toContain('#7A3B8F');
  expect(row).toContain('Welcome');
  expect(row).toContain('.webp');

  // Swap back → the same data re-applies for guests.
  const brandPlan = await createPlan(request, adminToken, {
    nameEn: `QA e18 on ${Date.now().toString(36)}`,
    enabledModules: await moduleList(request, adminToken, true),
  });
  const swapOn = await apiPatch(request, `/hotels/${hotel.hotelId}/subscription`, {
    planId: brandPlan,
    billingCycle: 'monthly',
  }, adminToken);
  expect(swapOn.status).toBe(200);

  await new Promise((r) => setTimeout(r, 65_000));
  const rebranded = await apiGet<GuestProfile>(request, `/guest/${hotel.slug}/profile`);
  expect(rebranded.body.brandAccentColor).toBe('#7A3B8F');
  expect(rebranded.body.coverImageUrl).toBeTruthy();
  expect(rebranded.body.welcomeMessage).toMatchObject({ en: 'Welcome', ar: 'أهلاً' });
});
