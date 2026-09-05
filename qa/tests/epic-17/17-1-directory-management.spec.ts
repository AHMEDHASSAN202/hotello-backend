/**
 * Epic 17 — Story 17.1 Hotel Info directory management (tenant API).
 *
 * Serial mode (runbook pitfall 11): the tests share one beforeAll hotel and
 * the file ends with the known-failing reorder test (QA-17-001 — a product
 * bug, kept failing on purpose), so a single ordered worker keeps the rest
 * of the file green instead of racing it across workers.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPatch,
  createFullModulePlan,
  createPlan,
  createStaffUser,
  provisionHotel,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { lastAuditMetaByMeta } from '../../helpers/db';
import {
  apiDelete,
  createEntry,
  overview,
  putAbout,
  putEssentials,
  removePhoto,
  reorderEntries,
  tinyPng,
  updateEntry,
  uploadPhoto,
} from './helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

let dedicated: ProvisionedHotel;

test.beforeAll(async ({ request, adminToken }) => {
  test.setTimeout(600_000);
  const planId = await createFullModulePlan(request, adminToken, `QA E17 Full ${Date.now().toString(36)}`);
  dedicated = await provisionHotel(request, { epic: 'e17', tag: `dir${Date.now().toString(36)}`, planId, adminToken });
});

test('17.1 AC1 — a virgin hotel: empty overview and a live checkout-time projection', async ({
  request,
  adminToken,
}) => {
  const planId = await createFullModulePlan(request, adminToken, `QA E17 Virgin ${Date.now().toString(36)}`);
  const h = await provisionHotel(request, { epic: 'e17', tag: `vgn${Date.now().toString(36)}`, planId, adminToken });

  const v = await overview(request, h.ownerToken);
  expect(v.checkoutTime, 'Epic 13 default projected, read-only here').toBe('12:00');
  expect(v.essentials).toBeNull();
  expect(v.about).toBeNull();
  expect(v.facilities).toEqual([]);
  expect(v.services).toEqual([]);
  expect(v.houseRules).toEqual([]);

  // The projection is LIVE — the stays setting is the single source (note 4).
  const patch = await apiPatch(request, '/tenant/stays/settings', { checkoutTime: '11:30' }, h.ownerToken);
  expect(patch.status, JSON.stringify(patch.body)).toBe(200);
  expect((await overview(request, h.ownerToken)).checkoutTime).toBe('11:30');

  // All-empty essentials upsert on a virgin hotel stays null (no ghost row).
  const empty = await putEssentials(request, h.ownerToken, {});
  expect(empty.status).toBe(200);
  expect(empty.body).toBeNull();
});

test('17.1 AC1 — facilities/services/rules each store their own structured fields', async ({
  request,
}) => {
  const token = dedicated.ownerToken;
  const pool = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'Rooftop Pool',
    nameAr: 'مسبح السطح',
    descriptionEn: 'Heated, towels included',
    descriptionAr: 'مسخّن ومناشف متاحة',
    windows: [{ start: '08:00', end: '22:00' }],
    locationNoteEn: 'Building B, floor 2',
    locationNoteAr: 'مبنى ب، الدور الثاني',
  });
  expect(pool.status, JSON.stringify(pool.body)).toBe(201);
  expect(pool.body.section).toBe('facilities');
  expect(pool.body.structured.windows).toEqual([{ start: '08:00', end: '22:00' }]);
  expect(pool.body.structured.locationNote).toEqual({
    en: 'Building B, floor 2',
    ar: 'مبنى ب، الدور الثاني',
  });
  expect(pool.body.isActive).toBe(true);

  const laundry = await createEntry(request, token, {
    section: 'services',
    nameEn: 'Laundry',
    nameAr: 'غسيل ملابس',
    howToEn: 'Hand the bag at the desk before 9:00',
    howToAr: 'سلّم الكيس في الاستقبال قبل التاسعة',
    priceNoteEn: 'From 50 EGP per kg',
  });
  expect(laundry.status, JSON.stringify(laundry.body)).toBe(201);
  expect(laundry.body.structured.howTo).toEqual({
    en: 'Hand the bag at the desk before 9:00',
    ar: 'سلّم الكيس في الاستقبال قبل التاسعة',
  });
  expect(laundry.body.structured.priceNote).toEqual({ en: 'From 50 EGP per kg' });

  const rule = await createEntry(request, token, {
    section: 'house_rules',
    nameEn: 'Quiet hours',
    nameAr: 'ساعات الهدوء',
    descriptionEn: 'From 22:00 to 08:00',
    descriptionAr: 'من ١٠ مساءً حتى ٨ صباحًا',
  });
  expect(rule.status, JSON.stringify(rule.body)).toBe(201);
  expect(rule.body.structured).toEqual({});
});

test('17.1 AC2 — AR+EN names required at both validation layers; optional locales stored', async ({
  request,
}) => {
  const token = dedicated.ownerToken;

  // Create layer: the DTO itself refuses a missing/blank AR or EN name (400).
  const noAr = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'Gym',
  } as never);
  expect(noAr.status).toBe(400);
  const blankAr = await createEntry(request, token, {
    section: 'services',
    nameEn: 'Gym',
    nameAr: '',
  });
  expect(blankAr.status).toBe(400);
  const blankEn = await createEntry(request, token, {
    section: 'services',
    nameEn: '',
    nameAr: 'جيم',
  });
  expect(blankEn.status).toBe(400);

  const multi = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'Gym',
    nameAr: 'جيم',
    nameRu: 'Спортзал',
    nameFr: 'Salle de sport',
  });
  expect(multi.status, JSON.stringify(multi.body)).toBe(201);
  expect(multi.body.names).toMatchObject({ en: 'Gym', ar: 'جيم', ru: 'Спортзал', fr: 'Salle de sport' });

  // Update layer: an optional DTO cannot blank a name away — the service
  // merge keeps ar+en alive and answers the stable code.
  const wipe = await updateEntry(request, token, multi.body.id, { nameEn: '' });
  expect(wipe.status).toBe(400);
  expect(wipe.body.code).toBe('HOTEL_INFO_NAMES_REQUIRED');
});

test('17.1 AC1 — aux fields are rejected on the wrong section (HOTEL_INFO_FIELD_INVALID)', async ({
  request,
}) => {
  const token = dedicated.ownerToken;
  const svc = await createEntry(request, token, { section: 'services', nameEn: 'Misfit', nameAr: 'خطأ' });
  expect(svc.status).toBe(201);

  const windowsOnService = await updateEntry(request, token, svc.body.id, {
    windows: [{ start: '08:00', end: '09:00' }],
  });
  expect(windowsOnService.status).toBe(400);
  expect(windowsOnService.body.code).toBe('HOTEL_INFO_FIELD_INVALID');
  expect((windowsOnService.body as { field?: string }).field).toBe('windows');

  const facilityHowTo = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'X',
    nameAr: 'س',
    howToEn: 'nope',
  });
  expect(facilityHowTo.status).toBe(400);
  expect(facilityHowTo.body.code).toBe('HOTEL_INFO_FIELD_INVALID');

  const ruleNote = await createEntry(request, token, {
    section: 'house_rules',
    nameEn: 'Y',
    nameAr: 'ص',
    locationNoteEn: 'nope',
  });
  expect(ruleNote.status).toBe(400);
  expect(ruleNote.body.code).toBe('HOTEL_INFO_FIELD_INVALID');

  const rulePrice = await createEntry(request, token, {
    section: 'house_rules',
    nameEn: 'Z',
    nameAr: 'ع',
    priceNoteEn: 'nope',
  });
  expect(rulePrice.status).toBe(400);
  expect(rulePrice.body.code).toBe('HOTEL_INFO_FIELD_INVALID');

  const facilityPrice = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'W',
    nameAr: 'و',
    priceNoteEn: 'nope',
  });
  expect(facilityPrice.status).toBe(400);

  // Custom sections do not exist in the MVP (fixed platform types).
  const custom = await createEntry(request, token, {
    section: 'custom' as never,
    nameEn: 'Nope',
    nameAr: 'لا',
  });
  expect(custom.status).toBe(400);
});

test('17.1 AC1 — hours windows keep the menu semantics (max 4, HH:MM, overnight ok)', async ({
  request,
}) => {
  const token = dedicated.ownerToken;
  const five = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'Overwindowed',
    nameAr: 'كثير',
    windows: Array.from({ length: 5 }, (_, i) => ({ start: `0${i}:00`, end: `0${i}:30` })),
  });
  expect(five.status).toBe(400);

  const badClock = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'Bad clock',
    nameAr: 'خطأ',
    windows: [{ start: '24:61', end: '10:00' }],
  });
  expect(badClock.status).toBe(400);

  const overnight = await createEntry(request, token, {
    section: 'facilities',
    nameEn: 'Night Club',
    nameAr: 'نادي ليلي',
    windows: [
      { start: '22:00', end: '02:00' },
      { start: '06:00', end: '08:00' },
    ],
  });
  expect(overnight.status, JSON.stringify(overnight.body)).toBe(201);
  expect(overnight.body.structured.windows).toEqual([
    { start: '22:00', end: '02:00' },
    { start: '06:00', end: '08:00' },
  ]);
});

test('17.1 AC3 — per-entry active toggle keeps the row in the editor', async ({ request }) => {
  const token = dedicated.ownerToken;
  const spa = await createEntry(request, token, { section: 'services', nameEn: 'Toggle Spa', nameAr: 'سبا' });
  expect(spa.status).toBe(201);

  const off = await updateEntry(request, token, spa.body.id, { isActive: false });
  expect(off.status).toBe(200);
  expect(off.body.isActive).toBe(false);

  // The EDITOR still sees it (curation ≠ deletion; no DELETE endpoint).
  const listed = (await overview(request, token)).services.find((s) => s.id === spa.body.id);
  expect(listed?.isActive).toBe(false);

  const back = await updateEntry(request, token, spa.body.id, { isActive: true });
  expect(back.status).toBe(200);
  expect(back.body.isActive).toBe(true);
});

test('17.1 AC3 — no DELETE endpoint: deactivation is the only removal', async ({ request }) => {
  const token = dedicated.ownerToken;
  const gone = await apiDelete(request, '/tenant/hotel-info/entries/3f2504e0-4f89-11d3-9a0c-0305e82c3301', token);
  expect([404, 405]).toContain(gone.status);
});

test('17.1 AC1 — photos: facility cap 1, About gallery cap 8, invalid uploads refused', async ({
  request,
}) => {
  const token = dedicated.ownerToken;
  const png = { name: 'photo.png', mimeType: 'image/png', buffer: tinyPng() };

  const facility = await createEntry(request, token, { section: 'facilities', nameEn: 'Photo Pool', nameAr: 'مسبح' });
  expect(facility.status).toBe(201);

  const first = await uploadPhoto(request, token, facility.body.id, png);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body.photos).toHaveLength(1);
  expect(first.body.photos[0].thumbUrl).toMatch(/^files\/hotel-info\//);
  expect(first.body.photos[0].detailUrl).toMatch(/^files\/hotel-info\//);

  const second = await uploadPhoto(request, token, facility.body.id, png);
  expect(second.status).toBe(409);
  expect(second.body.code).toBe('HOTEL_INFO_PHOTOS_FULL');
  expect(second.body.max).toBe(1);
  expect(second.body.count).toBe(1);

  const invalid = await uploadPhoto(request, token, facility.body.id, {
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('definitely not an image'),
  });
  expect(invalid.status).toBe(400);
  expect(invalid.body.code).toBe('HOTEL_INFO_PHOTO_INVALID');

  // Sections without photo budget refuse uploads (essentials max 0).
  await putEssentials(request, token, { wifiName: 'Photo-Test' });
  const essentialsRow = (await overview(request, token)).essentials;
  expect(essentialsRow).toBeTruthy();
  const noPhoto = await uploadPhoto(request, token, essentialsRow!.id, png);
  expect(noPhoto.status).toBe(409);
  expect(noPhoto.body.code).toBe('HOTEL_INFO_PHOTOS_FULL');
  expect(noPhoto.body.max).toBe(0);

  // About gallery: up to 8, then full.
  await putAbout(request, token, { descriptionEn: 'Gallery hotel', descriptionAr: 'فندق' });
  const aboutRow = (await overview(request, token)).about;
  expect(aboutRow).toBeTruthy();
  for (let i = 0; i < 8; i++) {
    const up = await uploadPhoto(request, token, aboutRow!.id, png);
    expect(up.status, `gallery upload ${i + 1}: ${JSON.stringify(up.body)}`).toBe(200);
  }
  const ninth = await uploadPhoto(request, token, aboutRow!.id, png);
  expect(ninth.status).toBe(409);
  expect(ninth.body.code).toBe('HOTEL_INFO_PHOTOS_FULL');
  expect(ninth.body.max).toBe(8);
  expect(ninth.body.count).toBe(8);

  // Removal is by photo id; a second removal is a 404.
  const removed = await removePhoto(request, token, facility.body.id, first.body.photos[0].id);
  expect(removed.status).toBe(200);
  expect(removed.body.photos).toEqual([]);
  const again = await removePhoto(request, token, facility.body.id, first.body.photos[0].id);
  expect(again.status).toBe(404);
  expect(again.body.code).toBe('HOTEL_INFO_PHOTO_NOT_FOUND');
});

test('17.1 — about singleton: locale-replacing PUT; all-empty deletes the (photo-less) row', async ({
  request,
}) => {
  const token = dedicated.ownerToken;
  await putAbout(request, token, {
    descriptionEn: 'A calm boutique hotel.',
    descriptionAr: 'فندق بوتيك هادئ.',
    descriptionRu: 'Спокойный бутик-отель.',
  });
  // Self-contained: strip any photos earlier tests left on the about row —
  // with photos present the all-empty upsert KEEPS the row (storage already
  // points into it); the delete path is for photo-less rows.
  const withPhotos = (await overview(request, token)).about;
  for (const photo of withPhotos?.photos ?? []) {
    await removePhoto(request, token, withPhotos!.id, photo.id);
  }

  const cleared = await putAbout(request, token, { descriptionRu: '' });
  expect(cleared.status).toBe(200);
  expect(cleared.body?.descriptions).toMatchObject({ en: 'A calm boutique hotel.', ar: 'فندق بوتيك هادئ.' });
  expect(cleared.body?.descriptions?.ru).toBeUndefined();

  const allEmpty = await putAbout(request, token, { descriptionEn: '', descriptionAr: '' });
  expect(allEmpty.status).toBe(200);
  expect(allEmpty.body).toBeNull();
  expect((await overview(request, token)).about).toBeNull();
});

test('17.1 — tenant isolation: another hotel’s entries are invisible and uneditable (404)', async ({
  request,
  adminToken,
}) => {
  const token = dedicated.ownerToken;
  const mine = await createEntry(request, token, { section: 'facilities', nameEn: 'Isolation Pool', nameAr: 'مسبح' });
  expect(mine.status).toBe(201);

  const planId = await createFullModulePlan(request, adminToken, `QA E17 Iso ${Date.now().toString(36)}`);
  const other = await provisionHotel(request, { epic: 'e17', tag: `iso${Date.now().toString(36)}`, planId, adminToken });

  // Their overview is their own — nothing of ours leaks in.
  expect((await overview(request, other.ownerToken)).facilities).toEqual([]);

  const patch = await updateEntry(request, other.ownerToken, mine.body.id, { nameEn: 'Hijacked' });
  // Cross-tenant is a 404, never a 403 — don't confirm other tenants' rows.
  expect(patch.status).toBe(404);

  const photo = await uploadPhoto(request, other.ownerToken, mine.body.id, {
    name: 'p.png',
    mimeType: 'image/png',
    buffer: tinyPng(),
  });
  expect(photo.status).toBe(404);

  const reorder = await reorderEntries(request, other.ownerToken, 'facilities', [mine.body.id]);
  // Not their set — refused without confirming the foreign row exists.
  expect(reorder.status).toBe(400);
  expect(reorder.body.code).toBe('HOTEL_INFO_REORDER_INVALID');
});

test('17.1 — permission edges: hotel_info.manage gates every route; seeded roles hold it', async ({
  request,
}) => {
  const token = dedicated.ownerToken;

  // A role WITHOUT hotel_info.manage (rooms.read only): read AND write denied.
  const none = await createStaffUser(request, token, dedicated.slug, ['rooms.read']);
  const denied = await apiGet(request, '/tenant/hotel-info', none.token);
  expect(denied.status).toBe(403);
  const deniedCreate = await createEntry(request, none.token, {
    section: 'facilities',
    nameEn: 'Nope',
    nameAr: 'لا',
  });
  expect(deniedCreate.status).toBe(403);

  // A role with exactly hotel_info.manage works.
  const granted = await createStaffUser(request, token, dedicated.slug, ['hotel_info.manage']);
  expect((await apiGet(request, '/tenant/hotel-info', granted.token)).status).toBe(200);

  // The seeded Manager and Front Desk roles carry the permission (spec header).
  const roles = await apiGet<Array<{ nameEn: string; permissions: string[] }>>(
    request,
    '/tenant/roles/options',
    token,
  );
  expect(roles.status).toBe(200);
  expect(roles.body.find((r) => r.nameEn === 'Manager')?.permissions).toContain('hotel_info.manage');
  expect(roles.body.find((r) => r.nameEn === 'Front Desk')?.permissions).toContain('hotel_info.manage');
});

test('17.1 — module gating: a plan without hotel_info locks the whole management surface', async ({
  request,
  adminToken,
}) => {
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA E17 NoInfo ${Date.now().toString(36)}`,
    enabledModules: ['requests', 'fnb', 'housekeeping', 'guest_app_branding'],
  });
  const h = await provisionHotel(request, { epic: 'e17', tag: `off${Date.now().toString(36)}`, planId, adminToken });

  const view = await apiGet(request, '/tenant/hotel-info', h.ownerToken);
  expect(view.status).toBe(403);
  expect(view.body.code).toBe('MODULE_NOT_ENABLED');

  const put = await putEssentials(request, h.ownerToken, { wifiName: 'X' });
  expect(put.status).toBe(403);

  const created = await createEntry(request, h.ownerToken, { section: 'facilities', nameEn: 'X', nameAr: 'س' });
  expect(created.status).toBe(403);
});

test('17.1 AC5 — hotel_info.updated audits carry diffs; the WiFi password never lands in the clear', async ({
  request,
}) => {
  const token = dedicated.ownerToken;

  const up = await putEssentials(request, token, { wifiName: 'Audit-Suite', wifiPassword: 's3cret-WiFi-9137' });
  expect(up.status, JSON.stringify(up.body)).toBe(200);
  const meta = lastAuditMetaByMeta('hotel_info.updated', dedicated.hotelId);
  expect(meta, 'hotel_info.updated audit exists').toBeTruthy();
  expect(meta, 'masked-diff rule (spec note 3)').not.toContain('s3cret-WiFi-9137');
  const parsed = JSON.parse(meta!) as { diff: Record<string, unknown> };
  expect(parsed.diff.wifiPassword).toEqual({ changed: true });
  expect(parsed.diff.wifiName).toEqual({ from: null, to: 'Audit-Suite' });

  // Entry edits carry from/to diffs.
  const gym = await createEntry(request, token, { section: 'facilities', nameEn: 'Audit Gym', nameAr: 'جيم' });
  expect(gym.status).toBe(201);
  const renamed = await updateEntry(request, token, gym.body.id, { nameEn: 'Audit Gym II' });
  expect(renamed.status).toBe(200);
  const meta2 = JSON.parse(lastAuditMetaByMeta('hotel_info.updated', dedicated.hotelId)!) as {
    diff: { names?: { from: Record<string, string>; to: Record<string, string> } };
  };
  expect(meta2.diff.names?.from.en).toBe('Audit Gym');
  expect(meta2.diff.names?.to.en).toBe('Audit Gym II');
  // (Reorder audits are covered by the reorder test below — currently blocked
  // by QA-17-001, which 500s the endpoint before its audit can happen.)
});

test('17.1 AC3 — reorder within a section: exact-set rule, unknown sections 404 [QA-17-001]', async ({
  request,
}) => {
  // KNOWN FAILING — QA-17-001: every successful reorder answers 500 (the
  // service audits with the section STRING as entityId into a uuid column).
  // The rows DO land (verified by raw probe); the tests assert the correct
  // contract and stay red until the bug is fixed. Kept LAST in serial mode
  // so it cannot skip any other test.
  const token = dedicated.ownerToken;
  const a = await createEntry(request, token, { section: 'facilities', nameEn: 'Reorder A', nameAr: 'أ' });
  const b = await createEntry(request, token, { section: 'facilities', nameEn: 'Reorder B', nameAr: 'ب' });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);

  // The reorder set must reference EVERY current entry of the section once.
  const before = await overview(request, token);
  const others = before.facilities
    .map((f) => f.id)
    .filter((id) => id !== a.body.id && id !== b.body.id);
  const flipped = [b.body.id, a.body.id, ...others];
  const res = await reorderEntries(request, token, 'facilities', flipped);
  expect(res.status, `QA-17-001 — reorder 500s: ${JSON.stringify(res.body)}`).toBe(200);
  expect(res.body.map((e) => e.id)).toEqual(flipped);

  const after = await overview(request, token);
  expect(after.facilities.map((f) => f.id)).toEqual(flipped);
  expect(after.facilities[0].names.en).toBe('Reorder B');

  const dup = await reorderEntries(request, token, 'facilities', [a.body.id, a.body.id]);
  expect(dup.status).toBe(400);
  expect(dup.body.code).toBe('HOTEL_INFO_REORDER_INVALID');

  const partial = await reorderEntries(request, token, 'facilities', [a.body.id]);
  expect(partial.status).toBe(400);
  expect(partial.body.code).toBe('HOTEL_INFO_REORDER_INVALID');

  const foreign = await reorderEntries(request, token, 'facilities', [
    ...flipped.slice(0, -1),
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  ]);
  expect(foreign.status).toBe(400);
  expect(foreign.body.code).toBe('HOTEL_INFO_REORDER_INVALID');

  // Singletons are not repeatable sections.
  const essentialsReorder = await reorderEntries(request, token, 'essentials', [a.body.id]);
  expect(essentialsReorder.status).toBe(404);
  expect(essentialsReorder.body.code).toBe('HOTEL_INFO_SECTION_NOT_FOUND');
});

test('17.1 AC1 — essentials: full card, PUT full-replacement, all-empty deletes the row [QA-17-002]', async ({
  request,
}) => {
  // The first two sub-cases are green; the LAST sub-case is KNOWN FAILING —
  // QA-17-002: an all-empty PUT over an existing row deletes it but then
  // 500s (the audit fires after repo.remove(), when entry.id is already
  // null). Kept LAST in serial mode with the QA-17-001 test.
  const token = dedicated.ownerToken;
  const full = await putEssentials(request, token, {
    wifiName: 'Hotello-Guest',
    wifiPassword: 'sunrise2026',
    receptionPhone: '+20 100 123 4567',
    whatsapp: '+20 100 123 4568',
    emergencyPhone: '911',
  });
  expect(full.status, JSON.stringify(full.body)).toBe(200);
  expect(full.body?.structured).toMatchObject({
    wifiName: 'Hotello-Guest',
    wifiPassword: 'sunrise2026',
    receptionPhone: '+20 100 123 4567',
    whatsapp: '+20 100 123 4568',
    emergencyPhone: '911',
  });

  // PUT semantics: the editor sends the whole card — absent fields are cleared.
  const partial = await putEssentials(request, token, { wifiName: 'Hotello-Guest-2' });
  expect(partial.status).toBe(200);
  expect(partial.body?.structured).toEqual({ wifiName: 'Hotello-Guest-2' });

  const allEmpty = await putEssentials(request, token, {});
  expect(allEmpty.status, `QA-17-002 — clearing all fields 500s: ${JSON.stringify(allEmpty.body)}`).toBe(200);
  expect(allEmpty.body).toBeNull();
  expect((await overview(request, token)).essentials).toBeNull();
});
