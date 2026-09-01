/**
 * Epic 13 — Story 13.5 Guest Session Contract (public, hardened).
 *
 * Failure-path attempts here consume rate-limit budget, so this spec runs
 * against its OWN dedicated hotel (never the shared worker fixture hotel).
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiGetRetry,
  apiPatch,
  apiPost,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import {
  checkInOk,
  guestMe,
  guestSession,
  guestSessionOk,
  type GuestSession,
} from '../../helpers/stays';

let dedicated: ProvisionedHotel;
let dedicatedRooms: Record<string, string> = {};

test.beforeAll(async ({ request, adminToken }) => {
  dedicated = await provisionHotel(request, { epic: 'e13', tag: `gs${Date.now().toString(36)}`, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['101', '102', '103', '201', '202'], 1);
  const list = await apiGetRetry<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?pageSize=200',
    dedicated.ownerToken,
  );
  for (const room of list.body.data) dedicatedRooms[room.roomNumber] = room.id;
});

test('13.5 AC1 — entry returns a guest JWT + the minimal profile', async ({
  request,
}) => {
  const rooms = dedicatedRooms;
  const { stay, code } = await checkInOk(request, dedicated.ownerToken, {
    roomId: rooms['101'],
    guestName: 'Family Guest',
    language: 'fr',
  });

  const session = await guestSessionOk(request, dedicated.slug, '101', code);
  expect(session.accessToken.split('.')).toHaveLength(3);
  expect(session.profile).toMatchObject({
    guestName: 'Family Guest',
    roomNumber: '101',
    hotelNameEn: expect.any(String),
    slug: dedicated.slug,
    language: 'fr',
    checkOutDate: stay.checkOutDate,
  });
  expect(session.profile.hotelNameAr).toBeTruthy();
  expect(session.profile.hotelNameEn).toBeTruthy();

  // The token works on the guest probe (AC6).
  const me = await guestMe(request, session.accessToken);
  expect(me.status).toBe(200);
  expect((me.body as unknown as GuestSession['profile']).guestName).toBe('Family Guest');
});



test('13.5 AC2 — every wrong room/code combination is ONE generic error', async ({
  request,
}) => {
  const rooms = dedicatedRooms;
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['201'] });

  const wrongCode = await guestSession(request, dedicated.slug, '201', '000000');
  const wrongRoom = await guestSession(request, dedicated.slug, '999', '000000');
  const rightCodeWrongRoom = await guestSession(request, dedicated.slug, '202', code);

  for (const attempt of [wrongCode, wrongRoom, rightCodeWrongRoom]) {
    expect(attempt.status).toBe(401);
    expect((attempt.body as { code?: string }).code).toBe('INVALID_CODE');
    expect((attempt.body as { message?: string }).message).toBe('Invalid room or code');
  }
  // The body never distinguishes the cases.
  expect(JSON.stringify(wrongCode.body)).toEqual(JSON.stringify(wrongRoom.body));
});

test('13.5 AC2 — unknown slug → 404', async ({ request }) => {
  const res = await guestSession(request, 'qa-no-such-hotel', '101', '123456');
  expect(res.status).toBe(404);
  expect((res.body as { code?: string }).code).toBe('HOTEL_NOT_FOUND');
});

test('13.5 AC2 — suspended hotel → HOTEL_UNAVAILABLE', async ({ request, adminToken }) => {
  const victim = await provisionHotel(request, {
    epic: 'e13',
    tag: `sus${Date.now().toString(36)}`,
    adminToken,
  });
  const type = await standardTypeId(request, victim.ownerToken);
  await createRoomsQuickly(request, victim.ownerToken, type, ['101'], 1);
  const rlist = await apiGet<{ data: Array<{ id: string; roomNumber: string }> }>(
    request,
    '/tenant/rooms?search=101',
    victim.ownerToken,
  );
  const { code } = await checkInOk(request, victim.ownerToken, {
    roomId: rlist.body.data.find((r) => r.roomNumber === '101')!.id,
  });

  const suspend = await apiPatch(
    request,
    `/hotels/${victim.hotelId}/suspend`,
    { reason: 'hotel_request' },
    adminToken,
  );
  expect(suspend.status).toBe(200);

  const res = await guestSession(request, victim.slug, '101', code);
  expect(res.status).toBe(403);
  expect((res.body as { code?: string }).code).toBe('HOTEL_UNAVAILABLE');
});

test('13.5 AC5 — the same code opens sessions on multiple devices', async ({
  request,
}) => {
  const rooms = dedicatedRooms;
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['202'] });

  const d1 = await guestSessionOk(request, dedicated.slug, '202', code);
  const d2 = await guestSessionOk(request, dedicated.slug, '202', code);
  // Stateless JWTs may be byte-identical when issued in the same second —
  // multi-device means BOTH sessions are independently valid.
  expect((await guestMe(request, d1.accessToken)).status).toBe(200);
  expect((await guestMe(request, d2.accessToken)).status).toBe(200);
});

test('13.5 — guest JWT carries the guest audience; malformed tokens rejected', async ({
  request,
}) => {
  const rooms = dedicatedRooms;
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['102'] });
  const session = await guestSessionOk(request, dedicated.slug, '102', code);

  // decode the payload — audience must be 'guest'
  const payload = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString());
  expect(payload.aud).toBe('guest');
  expect(payload.hotelId).toBe(dedicated.hotelId);

  const garbage = await apiGet(request, '/guest/me', 'not-a-token');
  expect(garbage.status).toBe(401);
  const noToken = await apiGet(request, '/guest/me');
  expect(noToken.status).toBe(401);
});

test('13.5 AC1 — case/whitespace tolerance on room number, exact 6-digit code', async ({
  request,
}) => {
  const rooms = dedicatedRooms;
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['101'] });

  const padded = await guestSession(request, dedicated.slug, ' 101 ', code);
  expect(padded.status).toBe(200);

  const shortCode = await apiPost(request, `/guest/${dedicated.slug}/session`, {
    roomNumber: '101',
    code: '12345',
  });
  expect(shortCode.status).toBe(400);
});
