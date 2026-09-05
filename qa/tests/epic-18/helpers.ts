/**
 * Epic 18 helpers — Guest App Branding.
 *
 * Everything provisions through the real API with the `e18` epic tag
 * (slugs `qa-e18-...`); module plans come from the LIVE catalog so the
 * stale-seed pitfall (QA-14-001) never bites. The WCAG math below is a
 * deliberate copy of src/modules/branding/contrast.util.ts — suites must
 * not import application code, and the duplication is the sync check.
 */
import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  apiGet,
  apiPatch,
  apiPostForm,
  createPlan,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestSessionSteady, type GuestSession } from '../../helpers/stays';
import { GUEST_URL } from '../../helpers/guest-ui';

export const BRANDING_MODULE = 'guest_app_branding';

/** Live catalog minus (or with) the branding module — robust to drift. */
export async function moduleList(
  request: APIRequestContext,
  adminToken: string,
  withBranding: boolean,
): Promise<string[]> {
  // Retry infrastructure 429/5xx — this admin route shares throttles with
  // everything else running against the stack.
  const { apiGetRetry } = await import('../../helpers/gxp-api');
  const catalog = await apiGetRetry<Array<{ key: string }>>(
    request,
    '/plans/modules/catalog',
    adminToken,
  );
  expect(Array.isArray(catalog.body), 'modules catalog is a bare array').toBe(true);
  const keys = catalog.body.map((m) => m.key);
  expect(keys, 'guest_app_branding must exist in the platform catalog').toContain(BRANDING_MODULE);
  return withBranding ? keys : keys.filter((k) => k !== BRANDING_MODULE);
}

/**
 * Fresh hotel on a plan that does (or doesn't) include guest_app_branding.
 * Fresh hotel per scenario — the guest profile caches 60s per slug.
 */
export async function brandHotel(
  request: APIRequestContext,
  adminToken: string,
  tag: string,
  opts: { withModule?: boolean } = {},
): Promise<ProvisionedHotel> {
  const withModule = opts.withModule ?? true;
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA e18 ${tag} ${Date.now().toString(36)}`,
    enabledModules: await moduleList(request, adminToken, withModule),
  });
  return provisionHotel(request, {
    epic: 'e18',
    tag: `${tag}${Date.now().toString(36)}`,
    planId,
    adminToken,
  });
}

/** Brand-plan hotel + four rooms (floor 7) for stay/guest-UI scenarios. */
export async function brandHotelWithRooms(
  request: APIRequestContext,
  adminToken: string,
  tag: string,
): Promise<{ hotel: ProvisionedHotel; rooms: Record<string, string> }> {
  const hotel = await brandHotel(request, adminToken, tag);
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['701', '702', '703', '704'], 7);
  const list = await apiGet<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    hotel.ownerToken,
  );
  const rooms: Record<string, string> = {};
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;
  return { hotel, rooms };
}

// ------------------------------------------------------------ branding API

export interface BrandingView {
  brandAccentColor: string | null;
  coverThumbUrl: string | null;
  coverDetailUrl: string | null;
  welcomeMessage: Record<string, string> | null;
}

export interface BrandingPatch {
  brandAccentColor?: string;
  welcomeAr?: string;
  welcomeEn?: string;
  welcomeRu?: string;
  welcomeFr?: string;
  welcomeIt?: string;
  welcomeEs?: string;
  welcomeDe?: string;
}

export async function getBranding(
  request: APIRequestContext,
  token: string,
): Promise<{ status: number; body: BrandingView & { code?: string; message?: string } }> {
  return apiGet<BrandingView>(request, '/tenant/branding', token);
}

export async function patchBranding(
  request: APIRequestContext,
  token: string,
  dto: BrandingPatch,
): Promise<{ status: number; body: BrandingView & { code?: string; message?: string; suggestion?: string } }> {
  return apiPatch(request, '/tenant/branding', dto, token);
}

export async function uploadCover(
  request: APIRequestContext,
  token: string,
  file: { name: string; mimeType: string; buffer: Buffer } | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  // null file → a multipart body with no `file` part at all (the real
  // "no file attached" branch), not a zero-byte file part.
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = file
    ? { file: { name: file.name, mimeType: file.mimeType, buffer: file.buffer } }
    : { sentinel: 'no-file' };
  return apiPostForm(request, '/tenant/branding/cover', { multipart }, token);
}

/** DELETE verb (the shared helpers only ship GET/POST/PATCH forms). */
export async function deleteCover(
  request: APIRequestContext,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const del = await request.delete(`${apiBase()}/tenant/branding/cover`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: del.status(), body: (await del.json().catch(() => ({}))) as Record<string, unknown> };
}

function apiBase(): string {
  return process.env.GXP_API_URL ?? 'http://localhost:4000/api/v1';
}

/** A solid-color PNG (valid bytes for sharp; small but resizable). */
export function solidPng(width = 160, height = 90, color: [number, number, number] = [200, 60, 30]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color[0];
    png.data[i + 1] = color[1];
    png.data[i + 2] = color[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

// ------------------------------------------------------- WCAG (contrast.util mirror)

function srgbChannel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

export function contrastVsWhite(hex: string): number {
  const l = relativeLuminance(hex);
  return 1.05 / (l + 0.05);
}

export function accentAllowed(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex) && contrastVsWhite(hex) >= 3;
}

/** Mirror of nearestSafeAccent: multiplicative 2% darkening until it passes. */
export function nearestSafeAccentMirror(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#0E2A47';
  if (accentAllowed(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let step = 1; step <= 50; step++) {
    const f = 1 - step * 0.02;
    const candidate =
      '#' +
      [r, g, b]
        .map((c) => Math.max(0, Math.round(c * f)).toString(16).padStart(2, '0'))
        .join('');
    if (accentAllowed(candidate)) return candidate;
  }
  return '#0E2A47';
}

// ------------------------------------------------------------- guest UI boot

/**
 * Check in + open a guest session the way the app persists it, then land in
 * home. Falls back to one reload if the layout's profile fetch hit the shared
 * /guest 429 (infrastructure throttle, pitfall 8) and mis-rendered not-found.
 */
export async function openGuestHome(
  page: Page,
  request: APIRequestContext,
  hotel: ProvisionedHotel,
  rooms: Record<string, string>,
  roomNumber: string,
  guest: string,
  language = 'en',
): Promise<GuestSession> {
  const { code } = await checkInOk(request, hotel.ownerToken, {
    roomId: rooms[roomNumber],
    guestName: guest,
    language,
  });
  const session = await guestSessionSteady(request, hotel.slug, roomNumber, code);
  expect(session.status, JSON.stringify(session.body)).toBe(200);
  const ok = session.body as unknown as GuestSession;
  // The stay-locale cookie must ride the FIRST document request — the guest
  // app resolves the locale server-side (next-intl). Set it at the context
  // level; document.cookie in an init script would land after SSR.
  await page.context().addCookies([
    { name: 'gxp_guest_locale_stay', value: ok.profile.language, url: `${GUEST_URL}/` },
  ]);
  await page.addInitScript(
    ([token]) => {
      window.localStorage.setItem('gxp_guest_token', token!);
    },
    [ok.accessToken] as const,
  );
  await page.goto(`${GUEST_URL}/${hotel.slug}`);
  for (let i = 0; i < 3; i++) {
    const notFound = await page.getByText('Hotel not found', { exact: false }).count();
    if (!notFound) break;
    await page.waitForTimeout(5_000);
    await page.reload();
  }
  await expect(page.getByText(guest, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  return ok;
}
