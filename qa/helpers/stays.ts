/**
 * Epic 13 helpers — stays lifecycle + guest session entry.
 */
import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { apiGet, apiPost, TENANT_URL } from './gxp-api';

export const GUEST_LANGUAGES = ['ar', 'en', 'ru', 'fr', 'it', 'es', 'de'];

/** ISO date (YYYY-MM-DD) offset from today (UTC-based, matching the API's). */
export function todayPlus(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export interface StayView {
  id: string;
  roomId: string;
  roomNumber: string;
  floor: number | null;
  guestName: string;
  email: string | null;
  phone: string | null;
  language: string;
  guestsCount: number | null;
  note: string | null;
  checkInDate: string;
  checkOutDate: string;
  nightsRemaining: number | null;
  status: 'active' | 'checked_out';
  checkoutType: 'manual' | 'automatic' | null;
  checkedOutAt: string | null;
}

export interface CheckInInput {
  roomId: string;
  guestName?: string;
  language?: string;
  checkInDate?: string;
  checkOutDate?: string;
  email?: string;
  phone?: string;
  guestsCount?: number;
  note?: string;
}

let guestCounter = 0;
export function guestName(): string {
  guestCounter += 1;
  return `QA Guest ${Date.now().toString(36)}-${guestCounter}`;
}

/** Check in through the real endpoint; returns the stay AND the plaintext code. */
export async function checkIn(
  request: APIRequestContext,
  token: string,
  input: CheckInInput,
): Promise<{ status: number; body: Record<string, unknown>; code?: string; stay?: StayView }> {
  const res = await apiPost<{
    stay: StayView;
    code: string;
    message?: string;
    code_: string;
  }>(request, '/tenant/stays', {
    guestName: input.guestName ?? guestName(),
    roomId: input.roomId,
    language: input.language ?? 'en',
    checkInDate: input.checkInDate ?? todayPlus(0),
    checkOutDate: input.checkOutDate ?? todayPlus(3),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.guestsCount !== undefined ? { guestsCount: input.guestsCount } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  }, token);
  const body = res.body as unknown as Record<string, unknown>;
  return {
    status: res.status,
    body,
    code: (body as { code?: string }).code,
    stay: (body as { stay?: StayView }).stay,
  };
}

export async function checkInOk(
  request: APIRequestContext,
  token: string,
  input: CheckInInput,
): Promise<{ stay: StayView; code: string }> {
  const res = await checkIn(request, token, input);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { stay: res.stay!, code: res.code! };
}

export interface GuestSession {
  accessToken: string;
  profile: {
    guestName: string;
    roomNumber: string;
    hotelNameEn: string;
    hotelNameAr: string;
    slug: string;
    language: string;
    checkOutDate: string;
    stayType: string;
    stayId: string;
    dndActive: boolean;
  };
}

/** Guest session entry (13.5 AC1) — the real public endpoint. */
export async function guestSession(
  request: APIRequestContext,
  slug: string,
  roomNumber: string,
  code: string,
): Promise<{ status: number; body: Record<string, unknown> & GuestSession & { code?: string; message?: string; retryAfterSeconds?: number } }> {
  const res = await apiPost(request, `/guest/${slug}/session`, {
    roomNumber,
    code,
  });
  return res as { status: number; body: Record<string, unknown> & GuestSession & { code?: string; message?: string; retryAfterSeconds?: number } };
}

export async function guestSessionOk(
  request: APIRequestContext,
  slug: string,
  roomNumber: string,
  code: string,
): Promise<GuestSession> {
  const res = await guestSession(request, slug, roomNumber, code);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { accessToken: (res.body as unknown as GuestSession).accessToken, profile: (res.body as unknown as GuestSession).profile };
}

/**
 * Guest session attempt that retries GENERIC 429s (the shared /guest
 * 30/min/IP route throttle — infrastructure, not product behavior) until the
 * service's own response shape comes back.
 */
export async function guestSessionSteady(
  request: APIRequestContext,
  slug: string,
  roomNumber: string,
  code: string,
): Promise<{ status: number; body: Record<string, unknown> & GuestSession & { code?: string; message?: string } }> {
  for (;;) {
    const res = await guestSession(request, slug, roomNumber, code);
    const genericThrottle = res.status === 429 && !(res.body as { code?: string }).code;
    if (!genericThrottle) return res;
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

export async function guestMe(
  request: APIRequestContext,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return apiGet(request, '/guest/me', token);
}

/** Checkout via the real endpoint (expects 200). */
export async function checkoutOk(
  request: APIRequestContext,
  token: string,
  stayId: string,
): Promise<StayView> {
  const res = await apiPost<{ stay?: StayView; message?: string }>(
    request,
    `/tenant/stays/${stayId}/checkout`,
    {},
    token,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.stay!;
}

export async function listStays(
  request: APIRequestContext,
  token: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ status: number; body: { data: StayView[]; total: number; page?: number; pageSize?: number } & { code?: string } }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return apiGet(request, `/tenant/stays?${qs.toString()}`, token);
}

/** The tenant app URL for a hotel (path form). */
export function staysUrl(slug: string): string {
  return `${TENANT_URL}/t/${slug}/stays`;
}
