/**
 * Epic 16 helpers — F&B menus, locations, orders (guest + kitchen board).
 */
import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  apiGet,
  apiGetRetry,
  apiPost,
  createFullModulePlan,
  createRoomsQuickly,
  provisionHotel,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestSessionOk, type GuestSession } from '../../helpers/stays';

// ------------------------------------------------------------ provisioning

export interface FnbHotel {
  hotel: ProvisionedHotel;
  rooms: Record<string, string>;
  nextRoom(): string;
}

/** Provision a hotel on a full-module plan (fnb gated) with rooms. */
export async function provisionFnbHotel(
  request: APIRequestContext,
  adminToken: string,
  tag: string,
  roomNumbers: string[],
): Promise<FnbHotel> {
  const planId = await createFullModulePlan(request, adminToken, `QA FNB ${Date.now().toString(36)}`);
  const hotel = await provisionHotel(request, { epic: 'e16', tag, planId, adminToken });
  const type = await standardTypeId(request, hotel.ownerToken);
  await createRoomsQuickly(request, hotel.ownerToken, type, roomNumbers, 7);
  const rooms = await roomsMap(request, hotel.ownerToken);
  const unused = [...roomNumbers];
  return {
    hotel,
    rooms,
    nextRoom() {
      return unused.shift() ?? roomNumbers[roomNumbers.length - 1]!;
    },
  };
}

async function standardTypeId(request: APIRequestContext, token: string): Promise<string> {
  const res = await apiGetRetry<{ data: Array<{ id: string; nameEn: string }> }>(
    request,
    '/tenant/room-types',
    token,
  );
  const standard = res.body.data.find((t) => t.nameEn === 'Standard');
  expect(standard, 'seeded Standard room type').toBeTruthy();
  return standard!.id;
}

async function roomsMap(request: APIRequestContext, token: string): Promise<Record<string, string>> {
  const res = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    token,
  );
  const map: Record<string, string> = {};
  for (const room of res.body.data) map[room.roomNumber] = room.id;
  return map;
}

// ------------------------------------------------------------------ stays

export interface NewGuest {
  token: string;
  stayType: string;
  stay: { id: string; guestName: string; roomNumber: string };
  stayId: string;
  roomNumber: string;
  profile: { stayType: string; stayId: string; guestName: string };
}

export async function newGuest(
  request: APIRequestContext,
  fh: Pick<FnbHotel, 'hotel' | 'rooms' | 'nextRoom'>,
  opts: { stayType?: string; guestName?: string; language?: string } = {},
): Promise<NewGuest> {
  const roomNumber = fh.nextRoom();
  const { stay, code } = await checkInOk(request, fh.hotel.ownerToken, {
    roomId: fh.rooms[roomNumber],
    guestName: opts.guestName ?? `F&B Guest ${roomNumber}`,
    ...(opts.stayType ? { stayType: opts.stayType } : {}),
    ...(opts.language ? { language: opts.language } : {}),
  } as never);
  const session = await guestSessionOk(request, fh.hotel.slug, roomNumber, code);
  const profile = session.profile;
  return {
    token: session.accessToken,
    stayType: profile.stayType,
    stay: { id: stay.id, guestName: stay.guestName, roomNumber },
    stayId: profile.stayId,
    roomNumber,
    profile: { stayType: profile.stayType, stayId: profile.stayId, guestName: stay.guestName },
  };
}

export async function checkInStay(
  request: APIRequestContext,
  ownerToken: string,
  input: {
    roomId: string;
    stayType?: string;
    guestName?: string;
    language?: string;
    checkInDate?: string;
    checkOutDate?: string;
  },
): Promise<{ stay: { id: string; guestName: string; roomNumber: string; stayType?: string }; code: string }> {
  const { stayType, ...rest } = input;
  const { checkInOk } = await import('../../helpers/stays');
  const { stay, code } = await checkInOk(request, ownerToken, {
    ...rest,
    ...(stayType ? { stayType: stayType as never } : {}),
  });
  return { stay: stay as never, code };
}

// ------------------------------------------------------------------ menus

export interface FnbMenu {
  id: string;
  names: Record<string, string>;
  windows: Array<{ start: string; end: string }>;
  prepSlaMinutes: number;
  defaultIncludedFor?: string[] | null;
  isActive: boolean;
}

export interface FnbMenuData {
  nameEn: string;
  nameAr: string;
  nameRu?: string;
  nameFr?: string;
  nameIt?: string;
  nameEs?: string;
  nameDe?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  windows?: Array<{ start: string; end: string }>;
  prepSlaMinutes?: number;
  defaultIncludedFor?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export async function createMenu(
  request: APIRequestContext,
  token: string,
  data: FnbMenuData,
): Promise<{ status: number; body: Record<string, unknown> & { id?: string; code?: string } }> {
  return apiPost(request, '/tenant/fnb-menus', data, token);
}

export async function createMenuOk(
  request: APIRequestContext,
  token: string,
  data: FnbMenuData,
): Promise<FnbMenu & { id: string }> {
  const res = await createMenu(request, token, data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    id: (res.body as { id: string }).id,
    names: {
      en: data.nameEn,
      ar: data.nameAr,
      ...(data.nameRu ? { ru: data.nameRu } : {}),
    },
    windows: data.windows ?? [],
    prepSlaMinutes: data.prepSlaMinutes ?? 30,
    defaultIncludedFor: data.defaultIncludedFor ?? null,
    isActive: data.isActive ?? true,
  };
}

export async function createSectionOk(
  request: APIRequestContext,
  token: string,
  menuId: string,
  data: { nameEn: string; nameAr: string; sortOrder?: number },
): Promise<{ id: string; names: Record<string, string> }> {
  const res = await apiPost(request, `/tenant/fnb-menus/${menuId}/sections`, data, token);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: (res.body as { id: string }).id, names: { en: data.nameEn, ar: data.nameAr } };
}

export interface FnbItemData {
  nameEn: string;
  nameAr: string;
  nameRu?: string;
  descriptionEn?: string;
  price: number;
  includedFor?: string[] | null;
  variant?: {
    nameEn: string;
    nameAr: string;
    options: Array<{ nameEn: string; nameAr: string; price: number }>;
  } | null;
  allowNotes?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreatedItem {
  id: string;
  price: number;
  includedFor?: string[] | null;
  allowNotes?: boolean;
  isActive?: boolean;
  variant?: { options: Array<{ key: string; price: number }> };
}

export async function createItem(
  request: APIRequestContext,
  token: string,
  sectionId: string,
  data: FnbItemData,
): Promise<{ status: number; body: Record<string, unknown> & { id?: string; code?: string; variant?: { options: Array<{ key: string; price: number }> } } }> {
  return apiPost(request, `/tenant/fnb-menus/sections/${sectionId}/items`, data, token);
}

export async function createItemOk(
  request: APIRequestContext,
  token: string,
  sectionId: string,
  data: FnbItemData,
): Promise<CreatedItem> {
  const res = await createItem(request, token, sectionId, data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const body = res.body as {
    id: string;
    price: number;
    includedFor?: string[] | null;
    allowNotes?: boolean;
    isActive?: boolean;
    variant?: { options: Array<{ key: string; price: number }> };
  };
  return {
    id: body.id,
    price: body.price,
    includedFor: body.includedFor,
    allowNotes: body.allowNotes,
    isActive: body.isActive,
    variant: body.variant,
  };
}

// --------------------------------------------------------------- locations

export interface FnbLocationData {
  nameEn: string;
  nameAr: string;
  hasSpots?: boolean;
  spotLabelEn?: string;
  spotLabelAr?: string;
  sortOrder?: number;
}

export async function createLocation(
  request: APIRequestContext,
  token: string,
  data: FnbLocationData,
): Promise<{ status: number; body: Record<string, unknown> & { id?: string; key?: string; hasSpots?: boolean; spotLabel?: string | null; code?: string } }> {
  return apiPost(request, '/tenant/fnb-locations', data, token);
}

export async function createLocationOk(
  request: APIRequestContext,
  token: string,
  data: FnbLocationData,
): Promise<{ id: string; key: string; nameEn: string; hasSpots: boolean; spotLabel: string | null }> {
  const res = await createLocation(request, token, data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const body = res.body as { id: string; key?: string; hasSpots?: boolean; spotLabel?: string | null };
  return {
    id: body.id,
    key: body.key ?? data.nameEn.toLowerCase(),
    nameEn: data.nameEn,
    hasSpots: body.hasSpots ?? data.hasSpots ?? false,
    spotLabel: body.spotLabel ?? data.spotLabelEn ?? null,
  };
}

// ------------------------------------------------------------------ windows

/** A window covering the current UTC time (QA hotels pin UTC). */
export function openWindow(fromMinutes = 0, toMinutes = 1440): { start: string; end: string } {
  const now = new Date();
  const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes();
  const pad = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const startM = (minutesNow + fromMinutes + 1440) % 1440;
  let endM = Math.min(startM + Math.max(toMinutes - fromMinutes, 1), 1439);
  if (endM <= startM) endM = Math.min(startM + 30, 1439);
  if (endM === startM) endM = startM === 1439 ? startM - 1 : startM + 1;
  return { start: pad(startM), end: pad(endM) };
}

/** A window that is NOT covering the current time. */
export function closedWindow(fromMinutes = 180, toMinutes = 120): { start: string; end: string } {
  const now = new Date();
  const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes();
  const pad = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const startM = (minutesNow + fromMinutes + 1440) % 1440;
  const endM = (minutesNow + toMinutes + 1440) % 1440;
  if (endM > startM) return { start: pad(startM), end: pad(endM) };
  return { start: pad(startM), end: pad(Math.min(1439, startM + 30)) };
}

/** A 1x1 transparent PNG (photo upload tests). */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ------------------------------------------------------------------ staff

/** Create a staff user bound to a SEEDED role by name (e.g. 'F&B / Kitchen'). */
export async function createStaffWithRole(
  request: APIRequestContext,
  ownerToken: string,
  slug: string,
  roleName: string,
): Promise<{ token: string; id: string; name: string }> {
  const roles = await apiGetRetry<Array<{ id: string; nameEn: string }>>(
    request,
    '/tenant/roles',
    ownerToken,
  );
  const role = (roles.body ?? []).find((r) => r.nameEn === roleName);
  expect(role, `seeded role ${roleName}`).toBeTruthy();
  const { createStaffUser } = await import('../../helpers/gxp-api');
  const username = `fnb${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 30);
  const password = 'QaStaffPass1';
  const created = await apiPost(request, '/tenant/staff/direct', {
    name: roleName,
    username,
    roleId: role!.id,
    password,
  }, ownerToken);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const { tenantLogin } = await import('../../helpers/gxp-api');
  const first = await tenantLogin(request, slug, username, password);
  await apiPost(request, '/tenant/me/change-password', {
    currentPassword: password,
    newPassword: `Changed${password}`,
  }, first.accessToken);
  const staffId = (created.body as { staff?: { id?: string } }).staff?.id ?? '';
  return { token: first.accessToken, id: staffId, name: roleName };
}

// ------------------------------------------------------------------ guest

export interface GuestFnbItemView {
  id: string;
  name: string;
  unitPrice: number;
  included: boolean;
  variant: {
    label: string;
    options: Array<{ key: string; name: string; price: number; included: boolean; unitPrice: number }>;
  } | null;
  allowNotes: boolean;
}

export interface GuestFnbCatalogView {
  stayType: string;
  currency: string;
  paymentMethods: string[];
  locations: Array<{ id: string; key: string; name: string; hasNumberedSpots: boolean; spotLabel: string | null }>;
  menus: Array<{
    id: string;
    name: string;
    availability: { available: boolean; [k: string]: unknown };
    windows: Array<{ start: string; end: string }>;
    prepSlaMinutes: number;
    sections: Array<{ id: string; name: string; items: GuestFnbItemView[] }>;
  }>;
}

export async function guestMenus(
  request: APIRequestContext,
  guestToken: string,
): Promise<GuestFnbCatalogView> {
  const res = await apiGetRetry<{ paymentMethods: string[]; menus: GuestFnbCatalogView['menus'] } & Record<string, unknown>>(
    request,
    '/guest/fnb/menus',
    guestToken,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown as GuestFnbCatalogView;
}

export interface GuestFnbOrderLineView {
  itemId: string;
  itemName: string;
  variantOptionName: string | null;
  quantity: number;
  unitPrice: number;
  included: boolean;
  lineTotal: number;
  note: string | null;
}

export interface GuestFnbOrderView {
  id: string;
  status: string;
  destinationType: string;
  locationName: string | null;
  spot: string | null;
  roomNumber: string;
  paymentMethod: string | null;
  totalAmount: number;
  currency: string;
  slaTargetMinutes: number;
  settled: boolean;
  lines: GuestFnbOrderLineView[];
  [k: string]: unknown;
}

export async function guestOrders(
  request: APIRequestContext,
  guestToken: string,
  updatedSince?: string,
): Promise<{ status: number; body: { data: GuestFnbOrderView[]; serverTime?: string } }> {
  const qs = updatedSince ? `?updatedSince=${encodeURIComponent(updatedSince)}` : '';
  const res = await apiGetRetry<{ data: GuestFnbOrderView[]; serverTime?: string }>(
    request,
    `/guest/fnb/orders${qs}`,
    guestToken,
  );
  return { status: res.status, body: res.body as { data: GuestFnbOrderView[]; serverTime?: string } };
}

export async function guestCancelOrder(
  request: APIRequestContext,
  guestToken: string,
  orderId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await apiPost(request, `/guest/fnb/orders/${orderId}/cancel`, {}, guestToken);
  return res as { status: number; body: Record<string, unknown> };
}

// ------------------------------------------------------------------ orders

export interface OrderLine {
  itemId: string;
  variantKey?: string;
  quantity: number;
  note?: string;
}

export interface PlaceOrderInput {
  lines: OrderLine[];
  destination: { type: 'room' | 'location'; locationId?: string; spot?: string };
  paymentMethod?: string;
}

export async function placeOrder(
  request: APIRequestContext,
  guestToken: string,
  data: PlaceOrderInput,
): Promise<{ status: number; body: Record<string, unknown> & { id?: string; code?: string; limit?: number } }> {
  return apiPost(request, '/guest/fnb/orders', data, guestToken);
}

export async function placeOrderOk(
  request: APIRequestContext,
  guestToken: string,
  data: PlaceOrderInput,
): Promise<GuestFnbOrderView> {
  const res = await placeOrder(request, guestToken, data);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as GuestFnbOrderView;
}

// ------------------------------------------------------------------ board

export async function fnbBoard(
  request: APIRequestContext,
  token: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{
  status: number;
  body: {
    data: Array<Record<string, unknown> & {
      id: string;
      status: string;
      totalAmount: number;
      paymentMethod: string | null;
      destination?: { type: string; roomNumber?: string; locationName?: string; spot?: string | null };
      assignedTo?: { id: string; name: string } | null;
      dueAt?: string | null;
      lines: Array<{
        itemNameEn: string;
        itemNameAr: string;
        itemName: string;
        quantity: number;
        unitPrice: number;
        included: boolean;
        lineTotal: number;
        note: string | null;
      }>;
    }>;
    counts?: { open?: number; deliveredToday?: number; overdueNow?: number; revenueToday?: number };
    serverTime?: string;
  };
}> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return apiGetRetry(request, `/tenant/fnb-orders?${qs.toString()}`, token) as never;
}
