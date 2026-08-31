/**
 * Epic 11 — Story 11.1 Room Types (API-level E2E).
 * Spec: hotello-backend/specs/epic-11-rooms-qr-user-stories.md
 */
import { expect, test } from '../../fixtures';
import { apiPatch, apiPost } from '../../helpers/gxp-api';

test('11.1 AC2 — new hotels are seeded with Standard/Deluxe/Suite (AR + EN), active', async ({
  request,
  hotel,
}) => {
  const { listRoomTypes } = await import('../../helpers/gxp-api');
  const types = await listRoomTypes(request, hotel.ownerToken);
  const byEn = Object.fromEntries(types.map((t) => [t.nameEn, t]));
  expect(Object.keys(byEn).sort()).toEqual(['Deluxe', 'Standard', 'Suite']);
  for (const seeded of Object.values(byEn)) {
    expect(seeded.isActive, `${seeded.nameEn} seeded active`).toBe(true);
    expect(seeded.nameAr, `${seeded.nameEn} has an Arabic name`).toBeTruthy();
  }
});

test('11.1 AC1 — create a room type with EN + AR names and descriptions', async ({
  request,
  hotel,
}) => {
  const { status, body } = await apiPost(request, '/tenant/room-types', {
    nameEn: 'Royal Suite',
    nameAr: 'جناح ملكي',
    descriptionEn: 'Top-floor suite with a terrace',
    descriptionAr: 'جناح بأعلى دور مع تراس',
  }, hotel.ownerToken);
  expect(status).toBe(201);
  expect(body).toMatchObject({
    nameEn: 'Royal Suite',
    nameAr: 'جناح ملكي',
    descriptionEn: 'Top-floor suite with a terrace',
    descriptionAr: 'جناح بأعلى دور مع تراس',
    isActive: true,
  });
});

test('11.1 AC1 — duplicate type name is rejected (unique per hotel per language)', async ({
  request,
  hotel,
  standardType,
}) => {
  // Same EN name as the seeded Standard.
  const enDup = await apiPost(request, '/tenant/room-types', {
    nameEn: standardType.nameEn,
    nameAr: 'مسمى مختلف',
  }, hotel.ownerToken);
  expect(enDup.status).toBe(409);
  expect(enDup.body.code).toBe('ROOM_TYPE_NAME_TAKEN');

  // AR uniqueness too — same Arabic name as the seeded Standard.
  const arDup = await apiPost(request, '/tenant/room-types', {
    nameEn: 'Something Else',
    nameAr: standardType.nameAr,
  }, hotel.ownerToken);
  expect(arDup.status).toBe(409);
  expect(arDup.body.code).toBe('ROOM_TYPE_NAME_TAKEN');
});

test('11.1 AC1 — edit a room type (names, description)', async ({
  request,
  hotel,
}) => {
  const created = await apiPost<{ id: string }>(request, '/tenant/room-types', {
    nameEn: 'Executive',
    nameAr: 'تنفيذي',
  }, hotel.ownerToken);
  expect(created.status).toBe(201);

  const { status, body } = await apiPatch(request, `/tenant/room-types/${created.body.id}`, {
    nameEn: 'Executive Floor',
    descriptionAr: 'طابق تنفيذي',
  }, hotel.ownerToken);
  expect(status).toBe(200);
  expect(body).toMatchObject({ nameEn: 'Executive Floor', descriptionAr: 'طابق تنفيذي', nameAr: 'تنفيذي' });
});

test('11.1 AC1 — deactivate (and re-activate) an unused room type', async ({
  request,
  hotel,
}) => {
  const created = await apiPost<{ id: string }>(request, '/tenant/room-types', {
    nameEn: 'Temporary Type',
    nameAr: 'نوع مؤقت',
  }, hotel.ownerToken);
  expect(created.status).toBe(201);

  const off = await apiPatch(request, `/tenant/room-types/${created.body.id}`, {
    isActive: false,
  }, hotel.ownerToken);
  expect(off.status).toBe(200);
  expect(off.body).toMatchObject({ isActive: false });

  const on = await apiPatch(request, `/tenant/room-types/${created.body.id}`, {
    isActive: true,
  }, hotel.ownerToken);
  expect(on.status).toBe(200);
  expect(on.body).toMatchObject({ isActive: true });
});

test('11.1 AC3 — a type with rooms assigned cannot be deactivated (409 with count)', async ({
  request,
  hotel,
  standardType,
}) => {
  const { createRoomsQuickly } = await import('../../helpers/gxp-api');
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['511', '512'], 5);

  const off = await apiPatch(request, `/tenant/room-types/${standardType.id}`, {
    isActive: false,
  }, hotel.ownerToken);
  expect(off.status).toBe(409);
  expect(off.body.code).toBe('ROOM_TYPE_IN_USE');
  // "409 with count" — the payload must say how many rooms still use it.
  expect(off.body.roomsCount).toBe(2);
});
