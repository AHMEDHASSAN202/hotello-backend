/**
 * Epic 17 — Story 17.2 the guest directory (API surface) + tile tri-state
 * signals on the public profile.
 *
 * Cache discipline (spec decisions 6/7): the guest directory is cached 60s
 * per hotelId:language and the public profile 60s per slug, with no
 * invalidation hooks. Every test reads a guest language nobody read before,
 * and the one mutation-visibility flip uses the documented 61s TTL window
 * (labeled in the test name — not an arbitrary sleep).
 *
 * NOTE: the beforeAll seeding reorder tolerates HTTP 500 — QA-17-001 (the
 * reorder endpoint 500s AFTER applying; verified by raw probe). The correct
 * 200 contract is asserted (and currently fails) in 17-1.
 */
import { expect, test } from '../../fixtures';
import {
  apiGetRetry,
  apiPatch,
  createFullModulePlan,
  createPlan,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk, guestSessionSteady } from '../../helpers/stays';
import { createEntry, guestInfo, publicProfile, putAbout, putEssentials, reorderEntries, updateEntry } from './helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};
let roomSeq = 0;

test.beforeAll(async ({ request, adminToken }) => {
  test.setTimeout(600_000);
  const planId = await createFullModulePlan(request, adminToken, `QA E17 Guest ${Date.now().toString(36)}`);
  dedicated = await provisionHotel(request, { epic: 'e17', tag: `gst${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['601', '602', '603', '604'], 6);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) rooms[room.roomNumber] = room.id;

  const token = dedicated.ownerToken;
  const settings = await apiPatch(request, '/tenant/stays/settings', { checkoutTime: '11:30' }, token);
  expect(settings.status, JSON.stringify(settings.body)).toBe(200);

  const essentials = await putEssentials(request, token, {
    wifiName: 'Hotello-Guest',
    wifiPassword: 'sunrise2026',
    receptionPhone: '+20 100 123 4567',
    whatsapp: '+20 100 123 4568',
    emergencyPhone: '911',
  });
  expect(essentials.status, JSON.stringify(essentials.body)).toBe(200);

  const pool = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'Rooftop Pool',
    nameAr: 'مسبح السطح',
    nameFr: 'Piscine sur le toit',
    descriptionEn: 'Heated, towels included',
    descriptionAr: 'مسخّن ومناشف متاحة',
    windows: [{ start: '08:00', end: '22:00' }],
    locationNoteEn: 'Building B, floor 2',
    locationNoteAr: 'مبنى ب، الدور الثاني',
  });
  expect(pool.status, JSON.stringify(pool.body)).toBe(201);
  const centre = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'Business Centre',
    nameAr: 'مركز الأعمال',
  });
  expect(centre.status).toBe(201);
  const laundry = await createEntry(request, token, {
    section: 'services',
    nameEn: 'Laundry',
    nameAr: 'غسيل ملابس',
    howToEn: 'Hand the bag at the desk before 9:00',
    howToAr: 'سلّم الكيس في الاستقبال',
    priceNoteEn: 'From 50 EGP per kg',
  });
  const quiet = await createEntry(request, token, {
    section: 'house_rules',
    nameEn: 'Quiet hours',
    nameAr: 'ساعات الهدوء',
    descriptionEn: '22:00–08:00',
    descriptionAr: '١٠ مساءً–٨ صباحًا',
  });
  const about = await putAbout(request, token, {
    descriptionEn: 'A calm boutique hotel.\n\nRooftop pool opens at 8.',
    descriptionAr: 'فندق بوتيك هادئ.',
  });
  expect(laundry.status).toBe(201);
  expect(quiet.status).toBe(201);
  expect(about.status).toBe(200);

  // Curation (17.1 AC3) feeds the guest render order (17.2 AC2). The 500 is
  // QA-17-001 — the reorder still applies (rows land before the audit throws).
  const reorder = await reorderEntries(request, token, 'facilities', [centre.body.id, pool.body.id]);
  if (reorder.status !== 200) {
    console.warn(`QA-17-001: seeding reorder answered ${reorder.status} (order still applied)`);
  }
});

/** Fresh guest session per test — one language per test keeps cache keys unique. */
async function guest(request: Parameters<typeof checkInOk>[0], language: string): Promise<string> {
  roomSeq += 1;
  const roomNumber = `60${roomSeq}`;
  const { code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms[roomNumber],
    guestName: `Info Guest ${roomSeq}`,
    language,
  });
  const session = await guestSessionSteady(request, dedicated.slug, roomNumber, code);
  expect(session.status, JSON.stringify(session.body)).toBe(200);
  return (session.body as unknown as { accessToken: string }).accessToken;
}

test('17.2 AC2/AC3 — an ar guest gets the pinned Essentials, curated order, per-entry language', async ({
  request,
}) => {
  const info = await guestInfo(request, await guest(request, 'ar'));

  // Essentials pinned first and fully populated; checkout projected from 13.
  expect(info.essentials).not.toBeNull();
  expect(info.essentials!.wifiName).toBe('Hotello-Guest');
  expect(info.essentials!.wifiPassword).toBe('sunrise2026');
  expect(info.essentials!.receptionPhone).toBe('+20 100 123 4567');
  expect(info.essentials!.checkoutTime).toBe('11:30');

  // The reorder from beforeAll (Business Centre first) reaches the guest.
  expect(info.facilities.map((f) => f.name)).toEqual(['مركز الأعمال', 'مسبح السطح']);
  expect(info.facilities[1].locationNote).toBe('مبنى ب، الدور الثاني');
  expect(info.facilities[1].windows).toEqual([{ start: '08:00', end: '22:00' }]);

  // howTo is translated to AR; priceNote has no AR → EN fallback PER ENTRY.
  expect(info.services[0].name).toBe('غسيل ملابس');
  expect(info.services[0].howTo).toBe('سلّم الكيس في الاستقبال');
  expect(info.services[0].priceNote).toBe('From 50 EGP per kg');

  expect(info.houseRules[0].name).toBe('ساعات الهدوء');
  expect(info.about?.text).toBe('فندق بوتيك هادئ.');
});

test('17.2 AC3 — ru falls back to EN per entry; fr gets the fr name only where translated', async ({
  request,
}) => {
  const ru = await guestInfo(request, await guest(request, 'ru'));
  expect(ru.facilities.map((f) => f.name)).toEqual(['Business Centre', 'Rooftop Pool']);
  expect(ru.facilities[1].locationNote).toBe('Building B, floor 2');
  expect(ru.about?.text).toBe('A calm boutique hotel.\n\nRooftop pool opens at 8.');

  const fr = await guestInfo(request, await guest(request, 'fr'));
  // The pool carries a fr name; the centre does not → EN fallback for it.
  expect(fr.facilities.map((f) => f.name)).toEqual(['Business Centre', 'Piscine sur le toit']);
  expect(fr.facilities[1].locationNote).toBe('Building B, floor 2');
});

test('17.2 AC4 — inactive entries never reach guests; empty sections are omitted', async ({
  request,
  adminToken,
}) => {
  const planId = await createFullModulePlan(request, adminToken, `QA E17 Cur ${Date.now().toString(36)}`);
  const h = await provisionHotel(request, { epic: 'e17', tag: `cur${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, h.ownerToken);
  await createRoomsQuickly(request, h.ownerToken, type, ['611', '612'], 6);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    h.ownerToken,
  );
  const byNumber: Record<string, string> = {};
  for (const room of list.body.data) byNumber[room.roomNumber] = room.id;

  const visible = await createEntry(request, h.ownerToken, { section: 'facilities', nameEn: 'Visible Gym', nameAr: 'جيم' });
  const hidden = await createEntry(request, h.ownerToken, { section: 'facilities', nameEn: 'Hidden Spa', nameAr: 'سبا' });
  expect(visible.status).toBe(201);
  expect(hidden.status).toBe(201);
  const off = await updateEntry(request, h.ownerToken, hidden.body.id, { isActive: false });
  expect(off.status).toBe(200);
  const svc = await createEntry(request, h.ownerToken, { section: 'services', nameEn: 'Hidden Service', nameAr: 'خدمة' });
  expect(svc.status).toBe(201);
  await updateEntry(request, h.ownerToken, svc.body.id, { isActive: false });

  const { code } = await checkInOk(request, h.ownerToken, {
    roomId: byNumber['611'],
    guestName: 'Curation Guest',
    language: 'de',
  });
  const session = await guestSessionSteady(request, h.slug, '611', code);
  const info = await guestInfo(request, (session.body as unknown as { accessToken: string }).accessToken);
  expect(info.facilities.map((f) => f.name)).toEqual(['Visible Gym']);
  expect(info.services).toEqual([]);
  expect(info.houseRules).toEqual([]);
  expect(info.essentials).toBeNull();
  expect(info.about).toBeNull();

  // Reactivation restores the entry — read under a FRESH language key (60s cache).
  const on = await updateEntry(request, h.ownerToken, svc.body.id, { isActive: true });
  expect(on.status).toBe(200);
  const { code: code2 } = await checkInOk(request, h.ownerToken, {
    roomId: byNumber['612'],
    guestName: 'Curation Guest 2',
    language: 'es',
  });
  const session2 = await guestSessionSteady(request, h.slug, '612', code2);
  const info2 = await guestInfo(request, (session2.body as unknown as { accessToken: string }).accessToken);
  expect(info2.services.map((s) => s.name)).toEqual(['Hidden Service']);
});

test('17.2 AC1/AC4 — tri-state: empty flag false; fresh content flips the tile signals within one 60s cache window', async ({
  request,
  adminToken,
}) => {
  const planId = await createFullModulePlan(request, adminToken, `QA E17 TTL ${Date.now().toString(36)}`);
  const h = await provisionHotel(request, { epic: 'e17', tag: `ttl${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, h.ownerToken);
  await createRoomsQuickly(request, h.ownerToken, type, ['631'], 6);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    h.ownerToken,
  );

  // Arm checks BEFORE content: module on, zero content → flag false, and the
  // directory endpoint itself still answers 200 (the CLIENT hides the tile).
  expect((await publicProfile(request, h.slug)).hotelInfoHasContent).toBe(false);
  const { code } = await checkInOk(request, h.ownerToken, {
    roomId: list.body.data[0].id,
    guestName: 'TTL Guest',
    language: 'en',
  });
  const session = await guestSessionSteady(request, h.slug, '631', code);
  const guestToken = (session.body as unknown as { accessToken: string }).accessToken;
  const before = await guestInfo(request, guestToken);
  expect(before.essentials).toBeNull();
  expect(before.facilities).toEqual([]);
  expect(before.about).toBeNull();

  await putEssentials(request, h.ownerToken, { wifiName: 'Late Wifi' });
  const gym = await createEntry(request, h.ownerToken, { section: 'facilities', nameEn: 'Late Gym', nameAr: 'جيم' });
  expect(gym.status).toBe(201);

  // Documented window: HOTEL_INFO_CACHE_TTL_MS + the profile cache TTL (60s
  // each, TTL-only, no invalidation hooks — spec decisions 6/7).
  await new Promise((r) => setTimeout(r, 61_000));

  expect((await publicProfile(request, h.slug)).hotelInfoHasContent).toBe(true);
  const after = await guestInfo(request, guestToken);
  expect(after.essentials?.wifiName).toBe('Late Wifi');
  expect(after.facilities.map((f) => f.name)).toEqual(['Late Gym']);
});

test('17.2 AC1 — plan without hotel_info: guest directory 403 MODULE_NOT_ENABLED, profile lacks the module', async ({
  request,
  adminToken,
}) => {
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA E17 NoInfo ${Date.now().toString(36)}`,
    enabledModules: ['requests', 'fnb'],
  });
  const h = await provisionHotel(request, { epic: 'e17', tag: `goff${Date.now().toString(36)}`, planId, adminToken });
  const type = await standardTypeId(request, h.ownerToken);
  await createRoomsQuickly(request, h.ownerToken, type, ['641'], 6);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    h.ownerToken,
  );

  const { code } = await checkInOk(request, h.ownerToken, {
    roomId: list.body.data[0].id,
    guestName: 'Gated Guest',
    language: 'en',
  });
  const session = await guestSessionSteady(request, h.slug, '641', code);
  const guestToken = (session.body as unknown as { accessToken: string }).accessToken;

  const res = await apiGetRetry<{ code?: string; module?: string }>(request, '/guest/hotel-info', guestToken);
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MODULE_NOT_ENABLED');
  expect(res.body.module).toBe('hotel_info');

  // The tile tri-state's first arm: without the module the profile omits it.
  const profile = await publicProfile(request, h.slug);
  expect(profile.enabledModules).not.toContain('hotel_info');
});
