/**
 * Epic 17 helpers — Hotel Info directory (tenant CRUD + guest directory).
 *
 * Everything drives the real HTTP API the same way the frontends do. Shared
 * harness has no PUT/DELETE wrappers (workaround, not a fix): apiPut/apiDelete
 * live HERE, mirroring helpers/gxp-api.ts exactly.
 */
import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { API_URL, apiGet, apiGetRetry } from '../../helpers/gxp-api';

// ---------------------------------------------------------------- basic HTTP

export async function apiPut<T = Record<string, unknown>>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  token?: string,
): Promise<{ status: number; body: T }> {
  const res = await request.put(`${API_URL}${path}`, {
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  // The API answers a null controller return with a 200 and an EMPTY body
  // (0 bytes, no content-type) — normalize that to null, never {}.
  const text = await res.text();
  let body: T;
  if (text === '') body = null as T;
  else {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = {} as T;
    }
  }
  return { status: res.status(), body };
}

export async function apiDelete<T = Record<string, unknown>>(
  request: APIRequestContext,
  path: string,
  token?: string,
): Promise<{ status: number; body: T }> {
  const res = await request.delete(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

/** 1×1 PNG — the smallest image the rendition pipeline accepts. */
export function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

// ------------------------------------------------------------ tenant surface

export type InfoSection = 'essentials' | 'facilities' | 'services' | 'house_rules' | 'about';

export interface InfoPhoto {
  id: string;
  thumbUrl: string;
  detailUrl: string;
}

export interface InfoEntry {
  id: string;
  section: InfoSection;
  names: Record<string, string>;
  descriptions: Record<string, string> | null;
  structured: {
    wifiName?: string;
    wifiPassword?: string;
    receptionPhone?: string;
    whatsapp?: string;
    emergencyPhone?: string;
    windows?: Array<{ start: string; end: string }>;
    locationNote?: Record<string, string>;
    howTo?: Record<string, string>;
    priceNote?: Record<string, string>;
  };
  photos: InfoPhoto[];
  sortOrder: number;
  isActive: boolean;
}

export interface InfoOverview {
  checkoutTime: string;
  essentials: InfoEntry | null;
  facilities: InfoEntry[];
  services: InfoEntry[];
  houseRules: InfoEntry[];
  about: InfoEntry | null;
}

/** The management overview (every entry, inactive included). */
export async function overview(
  request: APIRequestContext,
  token: string,
): Promise<InfoOverview> {
  const res = await apiGetRetry<InfoOverview>(request, '/tenant/hotel-info', token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

export async function putEssentials(
  request: APIRequestContext,
  token: string,
  body: Partial<Record<'wifiName' | 'wifiPassword' | 'receptionPhone' | 'whatsapp' | 'emergencyPhone', string>>,
): Promise<{ status: number; body: InfoEntry | null }> {
  return apiPut<InfoEntry | null>(request, '/tenant/hotel-info/essentials', body, token);
}

export async function putAbout(
  request: APIRequestContext,
  token: string,
  body: Partial<Record<`description${'En' | 'Ar' | 'Ru' | 'Fr' | 'It' | 'Es' | 'De'}`, string>>,
): Promise<{ status: number; body: InfoEntry | null }> {
  return apiPut<InfoEntry | null>(request, '/tenant/hotel-info/about', body, token);
}

export interface EntryInput {
  section: InfoSection;
  nameEn: string;
  nameAr: string;
  nameRu?: string;
  nameFr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  descriptionFr?: string;
  locationNoteEn?: string;
  locationNoteAr?: string;
  locationNoteFr?: string;
  howToEn?: string;
  howToAr?: string;
  priceNoteEn?: string;
  priceNoteAr?: string;
  windows?: Array<{ start: string; end: string }>;
  isActive?: boolean;
}

export async function createEntry(
  request: APIRequestContext,
  token: string,
  body: EntryInput,
): Promise<{ status: number; body: InfoEntry & { code?: string; message?: string; field?: string } }> {
  const res = await request.post(`${API_URL}/tenant/hotel-info/entries`, {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: res.status(),
    body: (await res.json().catch(() => ({}))) as InfoEntry & { code?: string; message?: string; field?: string },
  };
}

export async function updateEntry(
  request: APIRequestContext,
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: InfoEntry & { code?: string; message?: string } }> {
  const res = await request.patch(`${API_URL}/tenant/hotel-info/entries/${id}`, {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: res.status(),
    body: (await res.json().catch(() => ({}))) as InfoEntry & { code?: string; message?: string },
  };
}

export async function reorderEntries(
  request: APIRequestContext,
  token: string,
  section: InfoSection,
  entryIds: string[],
): Promise<{ status: number; body: InfoEntry[] & { code?: string; message?: string } }> {
  const res = await request.post(`${API_URL}/tenant/hotel-info/sections/${section}/reorder`, {
    data: { entryIds },
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as InfoEntry[] & { code?: string; message?: string } };
}

export async function uploadPhoto(
  request: APIRequestContext,
  token: string,
  entryId: string,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<{ status: number; body: InfoEntry & { code?: string; message?: string; max?: number; count?: number } }> {
  const res = await request.post(`${API_URL}/tenant/hotel-info/entries/${entryId}/photos`, {
    multipart: { file },
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as InfoEntry & { code?: string; message?: string; max?: number; count?: number } };
}

export async function removePhoto(
  request: APIRequestContext,
  token: string,
  entryId: string,
  photoId: string,
): Promise<{ status: number; body: InfoEntry & { code?: string; message?: string } }> {
  return apiDelete(request, `/tenant/hotel-info/entries/${entryId}/photos/${photoId}`, token);
}

// ------------------------------------------------------------ guest surface

export interface GuestInfo {
  essentials: {
    wifiName: string | null;
    wifiPassword: string | null;
    receptionPhone: string | null;
    whatsapp: string | null;
    emergencyPhone: string | null;
    checkoutTime: string;
  } | null;
  facilities: Array<{
    id: string;
    name: string;
    description: string | null;
    windows: Array<{ start: string; end: string }>;
    locationNote: string | null;
    photoThumbUrl: string | null;
    photoDetailUrl: string | null;
  }>;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    howTo: string | null;
    priceNote: string | null;
  }>;
  houseRules: Array<{ id: string; name: string; description: string | null }>;
  about: { text: string | null; gallery: Array<{ thumbUrl: string; detailUrl: string }> } | null;
}

/** The guest directory (server-language-resolved; 60s hotel+language cache). */
export async function guestInfo(
  request: APIRequestContext,
  guestToken: string,
): Promise<GuestInfo> {
  const res = await apiGetRetry<GuestInfo & { code?: string }>(request, '/guest/hotel-info', guestToken);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

export interface PublicProfile {
  slug: string;
  enabledModules: string[];
  hotelInfoHasContent: boolean;
  checkoutTime: string;
  [k: string]: unknown;
}

/** The public profile — carries the tile tri-state signal. */
export async function publicProfile(
  request: APIRequestContext,
  slug: string,
): Promise<PublicProfile> {
  const res = await apiGetRetry<PublicProfile>(request, `/guest/${slug}/profile`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** 'HH:MM' N minutes from now (UTC — QA hotels are pinned to UTC). */
export function utcTimePlus(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
