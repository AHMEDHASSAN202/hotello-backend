/**
 * Epic 16 — Story 16.3 delivery locations + QR stickers.
 */
import { expect, test } from '../../fixtures';
import { apiGet, apiGetRaw, apiPatch } from '../../helpers/gxp-api';
import {
  createLocationOk,
  createStaffWithRole,
  guestMenus,
  newGuest,
  provisionFnbHotel,
  type FnbHotel,
} from './helpers';

let fh: FnbHotel;
let other: FnbHotel;

test.beforeAll(async ({ request, adminToken }) => {
  fh = await provisionFnbHotel(request, adminToken, `loc${Date.now().toString(36)}`, ['721', '722']);
  other = await provisionFnbHotel(request, adminToken, `locB${Date.now().toString(36)}`, ['781']);
});

test('16.3 AC1 — locations: AR+EN required; spots toggle + bilingual spot label stored', async ({
  request,
}) => {
  const missingAr = await apiPost16(request, '/tenant/fnb-locations', { nameEn: 'Pool' });
  expect(missingAr.status).toBe(400);

  const pool = await createLocationOk(request, fh.hotel.ownerToken, {
    nameEn: 'Pool',
    nameAr: 'المسبح',
    hasSpots: true,
    spotLabelEn: 'Umbrella',
    spotLabelAr: 'شمسية',
    sortOrder: 1,
  });
  expect(pool.key).toBe('pool');
  expect(pool.hasSpots).toBe(true);
  expect(pool.spotLabel).toEqual({ en: 'Umbrella', ar: 'شمسية' });

  const beach = await createLocationOk(request, fh.hotel.ownerToken, {
    nameEn: 'Beach A',
    nameAr: 'الشاطئ أ',
    sortOrder: 2,
  });
  expect(beach.key).toBe('beach-a');
  expect(beach.hasSpots).toBe(false);
  expect(beach.spotLabel).toBeNull();

  const list = await apiGet<{ locations: Array<{ id: string; key: string; names: Record<string, string> }> }>(
    request,
    '/tenant/fnb-locations',
    fh.hotel.ownerToken,
  );
  expect(list.status).toBe(200);
  const keys = list.body.locations.map((l) => l.key);
  expect(keys).toContain('pool');
  expect(keys).toContain('beach-a');
  // "My room" is implicit — never a managed location.
  expect(keys.find((k) => /room/i.test(k))).toBeUndefined();
});

test('16.3 AC1 — duplicate EN names get deduped keys (slug + numeric suffix)', async ({
  request,
}) => {
  await createLocationOk(request, fh.hotel.ownerToken, { nameEn: 'Lobby', nameAr: 'اللوبي' });
  const second = await createLocationOk(request, fh.hotel.ownerToken, { nameEn: 'Lobby', nameAr: 'اللوبي' });
  expect(second.key).toBe('lobby-2');
});

test('16.3 AC4 — location keys are immutable: rename changes display names only', async ({
  request,
}) => {
  const loc = await createLocationOk(request, fh.hotel.ownerToken, { nameEn: 'Garden', nameAr: 'الحديقة' });
  const renamed = await apiPatch(request, `/tenant/fnb-locations/${loc.id}`, {
    nameEn: 'Palm Garden',
    nameAr: 'حديقة النخيل',
  }, fh.hotel.ownerToken);
  expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
  const body = renamed.body as unknown as { key: string; names: Record<string, string> };
  expect(body.key).toBe('garden');
  expect(body.names.en).toBe('Palm Garden');
  expect(body.names.ar).toBe('حديقة النخيل');
});

test('16.3 AC4 — deactivating hides from guests while QR routes keep resolving', async ({
  request,
}) => {
  const loc = await createLocationOk(request, fh.hotel.ownerToken, { nameEn: 'Rooftop', nameAr: 'السطح' });
  const guest = await newGuest(request, fh, { stayType: 'room_only' });
  let catalog = await guestMenus(request, guest.token);
  expect(catalog.locations.find((l) => l.id === loc.id)).toBeTruthy();

  const off = await apiPatch(request, `/tenant/fnb-locations/${loc.id}`, { isActive: false }, fh.hotel.ownerToken);
  expect(off.status).toBe(200);

  catalog = await guestMenus(request, guest.token);
  expect(catalog.locations.find((l) => l.id === loc.id)).toBeUndefined();

  // Printed QRs must not break: the routes still resolve for an inactive row.
  const qr = await apiGetRaw(request, `/tenant/fnb-locations/${loc.id}/qr`, fh.hotel.ownerToken);
  expect(qr.status).toBe(200);
});

test('16.3 AC2 — location QR: PNG + SVG, optional spot; spot on a spot-less location → 400', async ({
  request,
}) => {
  const pool = await createLocationOk(request, fh.hotel.ownerToken, {
    nameEn: 'QR Pool',
    nameAr: 'مسبح',
    hasSpots: true,
  });
  const png = await apiGetRaw(request, `/tenant/fnb-locations/${pool.id}/qr`, fh.hotel.ownerToken);
  expect(png.status).toBe(200);
  expect(png.contentType).toBe('image/png');
  expect(png.body.subarray(1, 4).toString()).toBe('PNG');

  const svg = await apiGetRaw(request, `/tenant/fnb-locations/${pool.id}/qr?format=svg`, fh.hotel.ownerToken);
  expect(svg.status).toBe(200);
  expect(svg.contentType).toBe('image/svg+xml');

  const withSpot = await apiGetRaw(request, `/tenant/fnb-locations/${pool.id}/qr?spot=12`, fh.hotel.ownerToken);
  expect(withSpot.status).toBe(200);

  const flat = await createLocationOk(request, fh.hotel.ownerToken, { nameEn: 'QR Beach', nameAr: 'شاطئ' });
  const noSpots = await apiGetRaw(request, `/tenant/fnb-locations/${flat.id}/qr?spot=3`, fh.hotel.ownerToken);
  expect(noSpots.status).toBe(400);
});

test('16.3 AC2 — sticker PDFs: zone sticker, numbered series with exclusions; bad ranges rejected', async ({
  request,
}) => {
  const loc = await createLocationOk(request, fh.hotel.ownerToken, {
    nameEn: 'PDF Pool',
    nameAr: 'مسبح',
    hasSpots: true,
    spotLabelEn: 'Table',
    spotLabelAr: 'ترابيزة',
  });

  const zone = await apiGetRaw(request, `/tenant/fnb-locations/${loc.id}/pdf/stickers`, fh.hotel.ownerToken);
  expect(zone.status).toBe(200);
  expect(zone.contentType).toBe('application/pdf');
  expect(zone.body.subarray(0, 5).toString()).toBe('%PDF-');

  const series = await apiGetRaw(
    request,
    `/tenant/fnb-locations/${loc.id}/pdf/stickers?from=1&to=5&exclusions=3`,
    fh.hotel.ownerToken,
  );
  expect(series.status).toBe(200);
  expect(series.contentType).toBe('application/pdf');
  expect(series.body.length).toBeGreaterThan(1000);

  const halfRange = await apiGetRaw(
    request,
    `/tenant/fnb-locations/${loc.id}/pdf/stickers?from=2`,
    fh.hotel.ownerToken,
  );
  expect(halfRange.status).toBe(400);

  const flat = await createLocationOk(request, fh.hotel.ownerToken, { nameEn: 'PDF Beach', nameAr: 'شاطئ' });
  const noSpots = await apiGetRaw(
    request,
    `/tenant/fnb-locations/${flat.id}/pdf/stickers?from=1&to=4`,
    fh.hotel.ownerToken,
  );
  expect(noSpots.status).toBe(400);
});

test('16.3 — cross-tenant: another hotel\'s location is a 404, never a 403', async ({
  request,
}) => {
  const mine = await createLocationOk(request, fh.hotel.ownerToken, { nameEn: 'Private Deck', nameAr: 'سطح خاص' });
  const foreignPatch = await apiPatch(request, `/tenant/fnb-locations/${mine.id}`, {
    nameEn: 'Hijacked',
  }, other.hotel.ownerToken);
  expect(foreignPatch.status).toBe(404);
  expect((foreignPatch.body as { code?: string }).code).toBe('FNB_LOCATION_NOT_FOUND');

  const foreignQr = await apiGetRaw(
    request,
    `/tenant/fnb-locations/${mine.id}/qr`,
    other.hotel.ownerToken,
  );
  expect(foreignQr.status).toBe(404);
});

test('16.3 — permission edges: kitchen can list (read) but not manage; bare reader locked out', async ({
  request,
}) => {
  const kitchen = await createStaffWithRole(request, fh.hotel.ownerToken, fh.hotel.slug, 'F&B / Kitchen');
  const list = await apiGet(request, '/tenant/fnb-locations', kitchen.token);
  expect(list.status).toBe(200);
  const create = await apiPost16(request, '/tenant/fnb-locations', { nameEn: 'Terrace', nameAr: 'تراس' }, kitchen.token);
  expect(create.status).toBe(403);

  const reader = await createStaffWithRole(request, fh.hotel.ownerToken, fh.hotel.slug, 'Housekeeping');
  const denied = await apiGet(request, '/tenant/fnb-locations', reader.token);
  expect(denied.status).toBe(403);
});

// ------------------------------------------------------------------ utilities

async function apiPost16(
  request: Parameters<typeof apiGet>[0],
  path: string,
  body: Record<string, unknown>,
  token = fh.hotel.ownerToken,
): Promise<{ status: number; body: Record<string, unknown> & { code?: string } }> {
  const { apiPost } = await import('../../helpers/gxp-api');
  return apiPost(request, path, body, token);
}
