/**
 * Epic 18 — Story 18.2 AC2/AC3 in the Guest App: accent through the runtime
 * CSS custom property + PWA theme-color, cover header with legibility scrim,
 * welcome line under the greeting in the guest's language with EN fallback,
 * and the graceful defaults (no cover / no message / broken cover URL).
 */
import { expect, test } from '../../fixtures';
import { apiGet } from '../../helpers/gxp-api';
import { sql } from '../../helpers/db';
import { GUEST_URL } from '../../helpers/guest-ui';
import {
  brandHotelWithRooms,
  patchBranding,
  solidPng,
  uploadCover,
  openGuestHome,
} from './helpers';
import { guestName } from '../../helpers/stays';

test.setTimeout(420_000);

interface GuestProfile {
  brandAccentColor: string | null;
  coverImageUrl: string | null;
  welcomeMessage: Record<string, string> | null;
}

const ACCENT = '#7A3B8F';
const WELCOME_EN = 'Welcome to the heart of Hurghada';
const WELCOME_AR = 'أهلاً بكم في قلب الغردقة';

/** Seed branding through the real API BEFORE the app ever fetches the profile. */
async function applyFullBranding(
  request: Parameters<typeof patchBranding>[0],
  ownerToken: string,
): Promise<void> {
  const set = await patchBranding(request, ownerToken, {
    brandAccentColor: ACCENT,
    welcomeAr: WELCOME_AR,
    welcomeEn: WELCOME_EN,
  });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  const up = await uploadCover(request, ownerToken, {
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: solidPng(320, 180, [20, 90, 160]),
  });
  expect(up.status, JSON.stringify(up.body)).toBe(200);
}

test('18.2 AC2 — branding applies: cover header with scrim, welcome under the greeting, accent CSS variable, theme-color + manifest follow the accent', async ({
  page,
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await brandHotelWithRooms(request, adminToken, 'ui1');
  await applyFullBranding(request, hotel.ownerToken);

  await openGuestHome(page, request, hotel, rooms, '701', guestName(), 'en');

  // Cover renders as the home header…
  const cover = page.getByTestId('home-cover');
  await expect(cover).toBeVisible();
  await expect(cover.locator('img')).toHaveAttribute('src', /files\/branding\//);
  // …with the legibility scrim between photo and text.
  await expect(cover.locator('div.bg-gradient-to-t')).toHaveCount(1);

  // Welcome message sits under the greeting, in the guest's language.
  await expect(page.getByTestId('home-welcome')).toHaveText(WELCOME_EN);

  // Accent flows through the runtime CSS custom property on the app frame
  // (the layout div carries it inline; dev injects other body children).
  const accent = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('div[style*="--accent"]');
    return frame ? getComputedStyle(frame).getPropertyValue('--accent').trim() : null;
  });
  expect(accent?.toLowerCase()).toBe(ACCENT.toLowerCase());

  // PWA theme-color follows the accent so the status bar blends (18.2 AC3).
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe(ACCENT);
  const manifest = await page.request.get(`${GUEST_URL}/${hotel.slug}/manifest.webmanifest`);
  expect(manifest.status()).toBe(200);
  expect(((await manifest.json()) as Record<string, string>).theme_color).toBe(ACCENT);
});

test('18.2 AC2 — welcome localizes per stay language: EN fallback for a language the hotel never wrote, AR + RTL for Arabic', async ({
  page,
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await brandHotelWithRooms(request, adminToken, 'ui2');
  await applyFullBranding(request, hotel.ownerToken);

  // A Russian guest: the hotel wrote no ru line → the EN line shows.
  await openGuestHome(page, request, hotel, rooms, '701', guestName(), 'ru');
  await expect(page.getByTestId('home-welcome')).toHaveText(WELCOME_EN);
  await page.close();

  // An Arabic guest on the same hotel: the AR line shows and the app flips RTL.
  const page2 = await page.context().newPage();
  await openGuestHome(page2, request, hotel, rooms, '702', guestName(), 'ar');
  await expect(page2.getByTestId('home-welcome')).toHaveText(WELCOME_AR);
  expect(await page2.locator('html').getAttribute('dir')).toBe('rtl');
  await page2.close();
});

test('18.2 AC3 — graceful defaults: no cover → clean header; no message → no empty gap; theme-color falls back to GXP navy', async ({
  page,
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await brandHotelWithRooms(request, adminToken, 'ui3');
  await openGuestHome(page, request, hotel, rooms, '701', guestName());

  await expect(page.getByTestId('home-cover')).toHaveCount(0);
  await expect(page.getByTestId('home-welcome')).toHaveCount(0);
  // The plain header still carries the hotel name.
  await expect(page.locator('header').first()).toBeVisible();

  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#0E2A47');
  const manifest = await page.request.get(`${GUEST_URL}/${hotel.slug}/manifest.webmanifest`);
  expect(((await manifest.json()) as Record<string, string>).theme_color).toBe('#0E2A47');

  // And the module-off hotel looks exactly as default (gating, API level).
  const profile = await apiGet<GuestProfile>(request, `/guest/${hotel.slug}/profile`);
  expect(profile.body.coverImageUrl).toBeNull();
  expect(profile.body.welcomeMessage).toBeNull();
});

test('18.2 AC3 — a broken cover URL degrades SILENTLY to the default header (no broken image, no error state)', async ({
  page,
  request,
  adminToken,
}) => {
  const { hotel, rooms } = await brandHotelWithRooms(request, adminToken, 'ui4');
  await applyFullBranding(request, hotel.ownerToken);
  // Poison the detail key AFTER the profile has been shaped (data-level:
  // the API has no "set garbage key" route by design).
  sql(
    `UPDATE hotels SET "coverImageDetailKey" = 'branding/${hotel.hotelId}/missing-detail.webp' WHERE id = '${hotel.hotelId}'`,
  );

  await openGuestHome(page, request, hotel, rooms, '701', guestName());

  // The cover mounts, the img 404s, and the app falls back to the plain
  // header — silently.
  await expect(page.getByTestId('home-cover')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('header').first()).toBeVisible();
  await expect(page.getByTestId('home-welcome')).toHaveText(WELCOME_EN);

  // The backend 404s the poisoned key for the record.
  const check = await apiGet<GuestProfile>(request, `/guest/${hotel.slug}/profile`);
  expect(check.body.coverImageUrl).toContain('missing-detail.webp');
});
