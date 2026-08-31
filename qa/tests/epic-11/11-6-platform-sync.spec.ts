/**
 * Epic 11 — Story 11.6 Rooms Count Becomes Real (Platform Sync).
 * Admin-side checks: derived count replaces the manual field; downgrade
 * guards compare against the derived count.
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPatch,
  apiPost,
  createPlan,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';

/** Fresh hotel (own plan, own room types) — one per test. */
async function setup(
  request: Parameters<typeof apiPost>[0],
  adminToken: string,
  tag: string,
  maxRooms: number,
) {
  const planId = await createPlan(request, adminToken, {
    nameEn: `QA Sync ${maxRooms} ${tag}`,
    maxRooms,
  });
  const hotel: ProvisionedHotel = await provisionHotel(request, {
    epic: 'e11',
    tag,
    planId,
    adminToken,
  });
  const type = await standardTypeId(request, hotel.ownerToken);
  return { hotel, type };
}

test('11.6 AC1 — the Super Admin hotel profile reports the derived room count', async ({
  request,
  adminToken,
}) => {
  const { hotel, type } = await setup(request, adminToken, `sy1${Date.now().toString(36)}`, 5);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['201', '202'], 2);
  await apiPost(request, '/tenant/rooms', {
    roomNumber: '203',
    roomTypeId: type,
    status: 'out_of_service',
  }, hotel.ownerToken);
  // inactive must not count — created active, then retired.
  await apiPost(request, '/tenant/rooms', { roomNumber: '204', roomTypeId: type }, hotel.ownerToken);
  const list = await apiGet<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms',
    hotel.ownerToken,
  );
  const victim = list.body.data.find((r) => r.roomNumber === '204')!;
  await apiPatch(request, `/tenant/rooms/${victim.id}`, { status: 'inactive' }, hotel.ownerToken);

  const profile = await apiGet<{ roomsCount?: number }>(
    request,
    `/hotels/${hotel.hotelId}`,
    adminToken,
  );
  expect(profile.status).toBe(200);
  // Derived = active + out_of_service = 3.
  expect(profile.body.roomsCount).toBe(3);
});

test('11.6 AC2 — the manual rooms_count field is retired: updates cannot set it', async ({
  request,
  adminToken,
}) => {
  const { hotel } = await setup(request, adminToken, `sy2${Date.now().toString(36)}`, 5);
  const patched = await apiPatch(request, `/hotels/${hotel.hotelId}`, {
    roomsCount: 500,
    declaredRoomsCount: 500,
  }, adminToken);
  expect(patched.status).toBe(200);
  const profile = await apiGet<{ roomsCount: number }>(request, `/hotels/${hotel.hotelId}`, adminToken);
  expect(profile.body.roomsCount).toBe(0);
});

test('11.6 AC3 — downgrade guard compares the derived count against target max_rooms', async ({
  request,
  adminToken,
}) => {
  const { hotel, type } = await setup(request, adminToken, `sy3${Date.now().toString(36)}`, 50);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['211', '212', '213'], 2);

  const smallPlan = await createPlan(request, adminToken, {
    nameEn: `QA Downgrade 2 ${Date.now().toString(36)}`,
    maxRooms: 2,
  });
  const blocked = await apiPatch(request, `/hotels/${hotel.hotelId}/subscription`, {
    planId: smallPlan,
    billingCycle: 'monthly',
  }, adminToken);
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('PLAN_LIMIT_VIOLATION');
  expect(JSON.stringify(blocked.body)).toContain('rooms');

  // Retire one room (inactive) → derived count 2 → the downgrade now fits.
  const list = await apiGet<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms',
    hotel.ownerToken,
  );
  const victim = list.body.data.find((r) => r.roomNumber === '213')!;
  await apiPatch(request, `/tenant/rooms/${victim.id}`, { status: 'inactive' }, hotel.ownerToken);

  const allowed = await apiPatch(request, `/hotels/${hotel.hotelId}/subscription`, {
    planId: smallPlan,
    billingCycle: 'monthly',
  }, adminToken);
  expect(allowed.status).toBe(200);
});

test('11.6 AC3 — force override stays Super-Admin-only on plan change', async ({
  request,
  adminToken,
}) => {
  const { hotel, type } = await setup(request, adminToken, `sy4${Date.now().toString(36)}`, 50);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['221', '222', '223'], 2);
  const smallPlan = await createPlan(request, adminToken, {
    nameEn: `QA Force 1 ${Date.now().toString(36)}`,
    maxRooms: 1,
  });

  const forced = await apiPatch(request, `/hotels/${hotel.hotelId}/subscription`, {
    planId: smallPlan,
    billingCycle: 'monthly',
    force: true,
  }, adminToken);
  expect(forced.status, 'wildcard admin may force').toBe(200);
});

test('11.6 AC3 — the plan-limit guard on room CREATION has no tenant-side force', async ({
  request,
  adminToken,
}) => {
  const { hotel, type } = await setup(request, adminToken, `sy5${Date.now().toString(36)}`, 3);
  await createRoomsQuickly(request, hotel.ownerToken, type, ['231', '232', '233'], 2);

  const attempted = await apiPost(request, '/tenant/rooms', {
    roomNumber: '234',
    roomTypeId: type,
    force: true,
  }, hotel.ownerToken);
  expect(attempted.status).toBe(409);
  expect(attempted.body.code).toBe('ROOM_LIMIT_REACHED');
});
