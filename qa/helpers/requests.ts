/**
 * Epic 15 helpers — guest requests + tenant board/lifecycle.
 */
import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { apiGet, apiGetRetry, apiPost } from './gxp-api';

export interface GuestCatalog {
  categories: Array<{
    id: string;
    name: string;
    icon: string;
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      icon: string;
      optionType: string | null;
      optionMin: number | null;
      optionMax: number | null;
    }>;
  }>;
}

export async function guestCatalog(
  request: APIRequestContext,
  guestToken: string,
): Promise<GuestCatalog> {
  const res = await apiGetRetry<GuestCatalog>(request, '/guest/catalog', guestToken);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

export interface GuestRequestView {
  id: string;
  itemName: string;
  icon: string;
  status: 'new' | 'in_progress' | 'done' | 'cancelled';
  optionValue: string | null;
  note: string | null;
  roomNumber: string;
  createdAt: string;
  [k: string]: unknown;
}

export async function submitGuestRequest(
  request: APIRequestContext,
  guestToken: string,
  itemId: string,
  opts: { optionValue?: string; note?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> & GuestRequestView & { code?: string; limit?: number } }> {
  const res = await apiPost(request, '/guest/requests', {
    itemId,
    ...(opts.optionValue !== undefined ? { optionValue: opts.optionValue } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  }, guestToken);
  return res as typeof res extends Promise<infer T> ? T : never;
}

const optionCache = new Map<string, Map<string, string>>();

/** The option value an item REQUIRES (quantity/time), from the guest catalog. */
async function requiredOptionValue(
  request: APIRequestContext,
  guestToken: string,
  itemId: string,
): Promise<string | undefined> {
  let map = optionCache.get(guestToken);
  if (!map) {
    const catalog = await guestCatalog(request, guestToken);
    map = new Map();
    for (const category of catalog.categories) {
      for (const item of category.items) {
        map.set(
          item.id,
          item.optionType === 'quantity'
            ? String(item.optionMin ?? 1)
            : item.optionType === 'time'
              ? '07:30'
              : '',
        );
      }
    }
    optionCache.set(guestToken, map);
  }
  const value = map.get(itemId);
  return value === '' ? undefined : value;
}

/**
 * Submit expecting success; auto-fills an item's REQUIRED option value when
 * the first attempt comes back REQUEST_OPTION_INVALID (many catalog items —
 * towels, wake-up call — cannot be submitted bare).
 */
export async function submitOk(
  request: APIRequestContext,
  guestToken: string,
  itemId: string,
  opts: { optionValue?: string; note?: string } = {},
): Promise<GuestRequestView> {
  let res = await submitGuestRequest(request, guestToken, itemId, opts);
  if (res.status === 400 && (res.body as { code?: string }).code === 'REQUEST_OPTION_INVALID') {
    const optionValue = await requiredOptionValue(request, guestToken, itemId);
    res = await submitGuestRequest(request, guestToken, itemId, { ...opts, optionValue });
  }
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as GuestRequestView;
}

export async function guestCancel(
  request: APIRequestContext,
  guestToken: string,
  requestId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return apiPost(request, `/guest/requests/${requestId}/cancel`, {}, guestToken);
}

export async function board(
  request: APIRequestContext,
  token: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{
  status: number;
  body: {
    data: Array<Record<string, unknown> & {
      id: string;
      status: string;
      roomNumber: string;
      guestName: string;
      itemNameEn?: string;
      itemName?: string;
      assignedTo?: { id: string; name: string } | null;
      dueAt?: string | null;
      createdAt: string;
    }>;
    counts?: { open: number; doneToday: number; overdueNow: number };
    serverTime?: string;
    total?: number;
  };
}> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return apiGet(request, `/tenant/requests?${qs.toString()}`, token);
}

/** Find a catalog item id by its English name on the tenant catalog view. */
export async function findCatalogItem(
  request: APIRequestContext,
  token: string,
  nameEn: string,
): Promise<{ itemId: string; categoryId: string } | null> {
  // The tenant catalog exposes translation MAPS (`names.en`), not flat fields.
  const res = await apiGetRetry<{
    categories: Array<{ id: string; names: { en: string }; items: Array<{ id: string; names: { en: string } }> }>;
  }>(request, '/tenant/request-catalog', token);
  for (const category of res.body.categories ?? []) {
    for (const item of category.items ?? []) {
      if (item.names?.en === nameEn) return { itemId: item.id, categoryId: category.id };
    }
  }
  return null;
}

/** Category id by its English name (tenant catalog exposes `names` maps). */
export async function findCatalogCategory(
  request: APIRequestContext,
  token: string,
  nameEn: string,
): Promise<string | null> {
  const res = await apiGetRetry<{
    categories: Array<{ id: string; names: { en: string } }>;
  }>(request, '/tenant/request-catalog', token);
  for (const category of res.body.categories ?? []) {
    if (category.names?.en === nameEn) return category.id;
  }
  return null;
}
