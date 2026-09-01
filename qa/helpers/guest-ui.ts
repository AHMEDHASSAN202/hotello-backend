/**
 * Epic 14 — guest-UI helpers. The guest app serves ALL hotels from one
 * origin (/:slug), so sessions are per-browser-context; every test gets a
 * fresh context.
 */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { apiPost } from './gxp-api';

export const GUEST_URL = process.env.GXP_GUEST_URL ?? 'http://localhost:3002';
export const API_URL = process.env.GXP_API_URL ?? 'http://localhost:4000/api/v1';

export interface GuestUiSession {
  accessToken: string;
  profile: {
    guestName: string;
    roomNumber: string;
    language: string;
    checkOutDate: string;
    [k: string]: unknown;
  };
}

/** Enter through the REAL public contract (the same call the entry form makes). */
export async function guestSession(
  request: Parameters<typeof apiPost>[0],
  slug: string,
  roomNumber: string,
  code: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await apiPost(request, `/guest/${slug}/session`, { roomNumber, code });
  return res as { status: number; body: Record<string, unknown> };
}

export async function guestSessionOk(
  request: Parameters<typeof apiPost>[0],
  slug: string,
  roomNumber: string,
  code: string,
): Promise<GuestUiSession> {
  const res = await guestSession(request, slug, roomNumber, code);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown as GuestUiSession;
}

/**
 * Seed a UI session the way the app persists it (localStorage token + the
 * stay-locale cookie), then open /{slug} — the boot probe must land in-home
 * without a flash of the entry form (14.2 AC4).
 */
export async function uiGuestSession(
  page: Page,
  slug: string,
  session: GuestUiSession,
) {
  await page.addInitScript(
    ([token, language]) => {
      window.localStorage.setItem('gxp_guest_token', token!);
      if (language) {
        document.cookie = `gxp_guest_locale_stay=${language}; path=/; max-age=604800; samesite=lax`;
      }
    },
    [session.accessToken, session.profile.language] as const,
  );
  await page.goto(`${GUEST_URL}/${slug}`);
}
