/**
 * GXP API test helpers — every suite drives the real HTTP API the way the
 * frontends do (bearer tokens, stable error codes). Nothing here is mocked.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const API_URL = process.env.GXP_API_URL ?? 'http://localhost:4000/api/v1';
export const TENANT_URL = process.env.GXP_TENANT_URL ?? 'http://localhost:3001';
export const ADMIN_EMAIL = process.env.GXP_ADMIN_EMAIL ?? 'admin@hotello.app';
export const ADMIN_PASSWORD = process.env.GXP_ADMIN_PASSWORD ?? 'ChangeMe123';

/**
 * The GUEST_APP_BASE_URL the backend under test actually runs with: env var
 * wins, else the backend repo's .env, else the code default.
 */
export function guestBaseUrl(): string {
  if (process.env.GXP_GUEST_APP_BASE_URL) return process.env.GXP_GUEST_APP_BASE_URL;
  try {
    // qa/ lives inside hotello-backend/ — read its .env without importing it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path');
    const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('GUEST_APP_BASE_URL='));
    if (line) return line.split('=').slice(1).join('=').trim();
  } catch {
    // fall through to the default
  }
  return 'https://guest.gxp.example';
}

/** Every hotel this suite creates uses this slug prefix; cleanup deletes it. */
export const QA_SLUG_PREFIX = 'qa-';

let slugCounter = 0;
export function qaSlug(epic: string, tag: string): string {
  slugCounter += 1;
  const rand = Math.random().toString(36).slice(2, 6);
  const slug = `${QA_SLUG_PREFIX}${epic}-${tag}-${Date.now().toString(36)}${slugCounter}${rand}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);
  return slug;
}

// ---------------------------------------------------------------- basic HTTP

/** All request paths are API-relative; this builds the absolute URL. */
function url(path: string): string {
  return `${API_URL}${path}`;
}

export async function apiPost<T = Record<string, unknown>>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  token?: string,
): Promise<{ status: number; body: T }> {
  const res = await request.post(url(path), {
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

export async function apiGet<T = Record<string, unknown>>(
  request: APIRequestContext,
  path: string,
  token?: string,
): Promise<{ status: number; body: T }> {
  const res = await request.get(url(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

export async function apiPatch<T = Record<string, unknown>>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  token?: string,
): Promise<{ status: number; body: T }> {
  const res = await request.patch(url(path), {
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

/** Raw response for binary downloads (PDF/xlsx/QR images). */
export async function apiGetRaw(
  request: APIRequestContext,
  path: string,
  token?: string,
): Promise<{ status: number; contentType: string; body: Buffer; headers: Record<string, string> }> {
  const res = await request.get(url(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return {
    status: res.status(),
    contentType: res.headers()['content-type'] ?? '',
    body: Buffer.from(await res.body()),
    headers: res.headers(),
  };
}

export async function apiPostForm(
  request: APIRequestContext,
  path: string,
  form: { multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> },
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post(url(path), {
    multipart: form.multipart,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

// ------------------------------------------------------------------- logins

export interface Session {
  accessToken: string;
  refreshToken: string;
}

/**
 * The product rate-limits logins (5/min/IP — SA-AUTH). Deterministic E2E
 * must respect that instead of racing it: every login reserves a slot from
 * the SHARED (cross-process, cross-run) throttle file first.
 */
async function pacedLogin<T>(fn: () => Promise<T>): Promise<T> {
  if ((process.env.GXP_LOGIN_PACING ?? 'on') === 'off') return fn();
  const { reserveLoginSlot } = (await import('./throttle')) as typeof import('./throttle');
  reserveLoginSlot();
  return fn();
}

/** One admin login per worker process, reused everywhere (15-min TTL JWT). */
let adminTokenCache: Promise<string> | null = null;
export function getAdminToken(request: APIRequestContext): Promise<string> {
  if (!adminTokenCache) {
    adminTokenCache = (async () => {
      const { reserveLoginSlot } = (await import('./throttle')) as typeof import('./throttle');
      reserveLoginSlot();
      return rawAdminLogin(request);
    })().catch((err) => {
      adminTokenCache = null;
      throw err;
    });
  }
  return adminTokenCache;
}

export async function adminLogin(request: APIRequestContext): Promise<string> {
  return getAdminToken(request);
}

async function rawAdminLogin(request: APIRequestContext): Promise<string> {
  const { status, body } = await apiPost<Session & { user?: unknown }>(request, '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (status !== 200) {
    throw new Error(`Admin login failed (${status}) — is the backend up with the seed applied?`);
  }
  return body.accessToken;
}

export async function tenantLogin(
  request: APIRequestContext,
  slug: string,
  identifier: string,
  password: string,
): Promise<Session> {
  return pacedLogin(async () => {
    const { status, body } = await apiPost<Session>(request, '/tenant/auth/login', {
      slug,
      identifier,
      password,
    });
    expect(status, 'tenant login').toBe(200);
    return body;
  });
}

// ------------------------------------------------------- hotel provisioning

export interface ProvisionedHotel {
  hotelId: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerToken: string;
  ownerRefresh: string;
  planId: string;
}

/**
 * Full tenant onboarding through the real flows: admin login → create hotel
 * (owner setup link is returned exactly once) → owner sets a password via the
 * setup token → owner logs in.
 */
export async function provisionHotel(
  request: APIRequestContext,
  opts: {
    epic: string;
    tag: string;
    slug?: string;
    planId?: string;
    createPlan?: PlanInput;
    defaultLanguage?: 'ar' | 'en';
    adminToken?: string;
  },
): Promise<ProvisionedHotel> {
  const adminToken = opts.adminToken ?? (await adminLogin(request));

  let planId = opts.planId;
  if (!planId && opts.createPlan) {
    planId = await createPlan(request, adminToken, opts.createPlan);
  }
  if (!planId) {
    // Fall back to the seeded Standard plan (unlimited). GET /plans returns a bare array.
    const plans = await apiGet<Array<{ id: string; nameEn: string }>>(
      request,
      '/plans',
      adminToken,
    );
    const standard = plans.body.find((p) => p.nameEn === 'Standard');
    if (!standard) throw new Error('Seeded Standard plan not found — run `npm run seed`');
    planId = standard.id;
  }

  const slug = opts.slug ?? qaSlug(opts.epic, opts.tag);
  const ownerEmail = `owner-${slug}@qa.example`;
  const ownerPassword = 'QaPassw0rd1';

  const onboard = await apiPost<{
    hotel: { id: string; slug: string };
    owner: { setupLink: string };
  }>(request, '/hotels', {
    profile: {
      nameEn: `QA ${opts.tag} Hotel`,
      nameAr: `فندق اختبار ${opts.tag}`,
      slug,
      contactEmail: `contact-${slug}@qa.example`,
      contactPhone: '+20 100 000 0000',
      city: 'Cairo',
      defaultLanguage: opts.defaultLanguage ?? 'en',
    },
    plan: { planId, billingCycle: 'monthly' },
    owner: { name: 'QA Owner', email: ownerEmail },
  }, adminToken);
  if (onboard.status !== 201) {
    throw new Error(`Hotel onboarding failed: ${JSON.stringify(onboard.body)}`);
  }

  // setupLink = {TENANT_APP}/{slug}/setup?token=... — pull the raw token out.
  const token = new URL(onboard.body.owner.setupLink).searchParams.get('token');
  expect(token, 'setup link carries a token').toBeTruthy();

  // The setup endpoint is rate-limited like the login (5/min/IP) — pace it.
  const setup = await pacedLogin(() => apiPost(request, '/tenant-users/setup', {
    token,
    password: ownerPassword,
  }));
  expect(setup.status, 'owner setup accepts the token').toBe(201);

  const session = await tenantLogin(request, slug, ownerEmail, ownerPassword);
  return {
    hotelId: onboard.body.hotel.id,
    slug,
    ownerEmail,
    ownerPassword,
    ownerToken: session.accessToken,
    ownerRefresh: session.refreshToken,
    planId,
  };
}

// -------------------------------------------------------------------- plans

export interface PlanInput {
  nameEn: string;
  maxRooms?: number | null;
  maxStaffUsers?: number | null;
  enabledModules?: string[];
  isTrial?: boolean;
  trialDurationDays?: number;
  monthlyPrice?: number;
}

const ALL_MODULES = [
  'transportation',
  'housekeeping',
  'fnb',
  'guest_app_branding',
  'analytics',
  'requests',
  'hotel_info',
  'announcements',
  'events',
];

export async function createPlan(
  request: APIRequestContext,
  adminToken: string,
  input: PlanInput,
): Promise<string> {
  const { status, body } = await apiPost<{ id: string }>(request, '/plans', {
    nameEn: input.nameEn,
    nameAr: input.nameEn,
    monthlyPrice: input.monthlyPrice ?? 0,
    maxRooms: input.maxRooms ?? null,
    maxStaffUsers: input.maxStaffUsers ?? null,
    enabledModules: input.enabledModules ?? ALL_MODULES,
    isTrial: input.isTrial ?? false,
    trialDurationDays: input.isTrial ? (input.trialDurationDays ?? 14) : null,
  }, adminToken);
  expect(status, `plan create: ${JSON.stringify(body)}`).toBe(201);
  return body.id;
}

// -------------------------------------------------------------- room helpers

export interface RoomType {
  id: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  isActive: boolean;
  roomsCount: number;
}

export async function listRoomTypes(
  request: APIRequestContext,
  token: string,
): Promise<RoomType[]> {
  const { status, body } = await apiGet<{ data: RoomType[] }>(
    request,
    '/tenant/room-types',
    token,
  );
  expect(status).toBe(200);
  return body.data;
}

/** The freshly-provisioned hotel's OWN seeded "Standard" type id. */
export async function standardTypeId(
  request: APIRequestContext,
  ownerToken: string,
): Promise<string> {
  const types = await listRoomTypes(request, ownerToken);
  const standard = types.find((t) => t.nameEn === 'Standard');
  expect(standard, 'seeded Standard room type').toBeTruthy();
  return standard!.id;
}

export async function createRoom(
  request: APIRequestContext,
  token: string,
  data: {
    roomNumber: string;
    floor?: number;
    roomTypeId: string;
    status?: 'active' | 'out_of_service';
  },
): Promise<{ status: number; body: Record<string, unknown> & { code?: string; roomNumber?: string; message?: string } }> {
  return apiPost(request, '/tenant/rooms', data, token);
}

export async function createRoomsQuickly(
  request: APIRequestContext,
  token: string,
  roomTypeId: string,
  numbers: string[],
  floor?: number,
): Promise<void> {
  const { status, body } = await apiPost(request, '/tenant/rooms/bulk', {
    rooms: numbers.map((roomNumber, row) => ({ row, roomNumber, floor, roomTypeId })),
    source: 'range',
  }, token);
  expect(status, `bulk seed failed: ${JSON.stringify(body)}`).toBe(201);
}

export interface RoomsListResponse {
  data: Array<{
    id: string;
    roomNumber: string;
    floor: number | null;
    status: 'active' | 'out_of_service' | 'inactive';
    roomType: { id: string; nameEn: string; nameAr: string } | null;
    currentStay?: { id: string; guestName: string; checkOutDate: string } | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  usage: { used: number; max: number | null };
}

export async function listRooms(
  request: APIRequestContext,
  token: string,
  query: Record<string, string | number | undefined> = {},
): Promise<{ status: number; body: RoomsListResponse & { code?: string; message?: string } }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return apiGet(request, `/tenant/rooms?${qs.toString()}`, token);
}

// ---------------------------------------------------------------- staff user

/**
 * Create a limited staff user (role with an explicit permission list) and
 * return a working session: direct creation forces `mustChangePassword`, so
 * the helper immediately changes the password and logs in again.
 */
export async function createStaffUser(
  request: APIRequestContext,
  ownerToken: string,
  slug: string,
  permissions: string[],
): Promise<{ token: string; refreshToken: string; username: string; password: string }> {
  const role = await apiPost<{ id: string; code?: string; message?: string }>(
    request,
    '/tenant/roles',
    {
      nameEn: `QA Role ${Date.now().toString(36)}`,
      nameAr: 'دور اختبار',
      permissions,
    },
    ownerToken,
  );
  expect(role.status, `role create: ${JSON.stringify(role.body)}`).toBe(201);

  const username = `qa${Date.now().toString(36)}`.slice(0, 30);
  const password = 'QaStaffPass1';
  const created = await apiPost<{ credentials?: { tempPassword?: string }; code?: string }>(
    request,
    '/tenant/staff/direct',
    { name: 'QA Staff', username, roleId: role.body.id, password },
    ownerToken,
  );
  expect(created.status, `staff create: ${JSON.stringify(created.body)}`).toBe(201);

  const first = await tenantLogin(request, slug, username, password);
  // change-password only clears the refresh hash — the access token stays
  // valid and mustChangePassword is now false, so no second login (the login
  // throttle is 5/min — pace it).
  const change = await apiPost(
    request,
    '/tenant/me/change-password',
    { currentPassword: password, newPassword: `Changed${password}` },
    first.accessToken,
  );
  expect([200, 201, 204]).toContain(change.status);
  return {
    token: first.accessToken,
    refreshToken: first.refreshToken,
    username,
    password: `Changed${password}`,
  };
}

// ------------------------------------------------------------------ UI auth

/**
 * Drive the real tenant login screen (no token injection) — exercises the
 * same form hotel staff use.
 */
export async function uiLogin(page: Page, slug: string, identifier: string, password: string) {
  const { reserveLoginSlot } = (await import('./throttle')) as typeof import('./throttle');
  reserveLoginSlot();
  await page.goto(`${TENANT_URL}/t/${slug}/login`);
  await page.getByLabel(/email|username|البريد|اسم المستخدم/i).first().fill(identifier);
  await page.getByLabel(/password|كلمة المرور/i).first().fill(password);
  await page.getByRole('button', { name: /log in|sign in|تسجيل الدخول/i }).click();
  await page.waitForURL(`**/t/${slug}/**`, { timeout: 20_000 });
}
