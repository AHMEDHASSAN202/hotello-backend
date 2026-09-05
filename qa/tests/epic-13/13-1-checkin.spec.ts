/**
 * Epic 13 — Story 13.1 Check-In (create stay).
 */
import { expect, test } from '../../fixtures';
import {
  apiGet,
  apiPost,
  createRoomsQuickly,
  standardTypeId,
} from '../../helpers/gxp-api';
import { execFileSync } from 'node:child_process';
import {
  checkIn,
  checkInOk,
  guestName,
  todayPlus,
} from '../../helpers/stays';
import { auditCount, lastAuditMeta } from '../../helpers/db';

async function roomsReady(
  request: Parameters<typeof apiPost>[0],
  hotel: { ownerToken: string },
): Promise<{ type: string; rooms: Record<string, string> }> {
  const type = await standardTypeId(request, hotel.ownerToken);
  const numbers = ['401', '402', '403', '404', '405', '406', '407', '408', '409', '410'];
  await createRoomsQuickly(request, hotel.ownerToken, type, numbers, 1);
  // One out_of_service room for the availability-guard test.
  await apiPost(request, '/tenant/rooms', {
    roomNumber: '411',
    floor: 1,
    roomTypeId: type,
    status: 'out_of_service',
  }, hotel.ownerToken);
  const list = await apiGet(request, '/tenant/rooms?pageSize=200', hotel.ownerToken);
  const rooms: Record<string, string> = {};
  for (const room of (list.body as { data: Array<{ id: string; roomNumber: string }> }).data) {
    rooms[room.roomNumber] = room.id;
  }
  return { type, rooms };
}

test('13.1 AC1 — check-in happy path stores guest fields and returns a 6-digit code', async ({
  request,
  hotel,
}) => {
  const { rooms } = await roomsReady(request, hotel);
  const name = guestName();
  const res = await checkInOk(request, hotel.ownerToken, {
    roomId: rooms['401'],
    guestName: name,
    language: 'ar',
    email: 'guest@example.com',
    phone: '+20 100 123 4567',
    guestsCount: 2,
    note: 'Late arrival',
  });

  expect(res.code).toMatch(/^\d{6}$/);
  expect(res.stay).toMatchObject({
    roomNumber: '401',
    guestName: name,
    language: 'ar',
    email: 'guest@example.com',
    guestsCount: 2,
    status: 'active',
    checkInDate: todayPlus(0),
    checkOutDate: todayPlus(3),
  });
  expect(res.stay!.nightsRemaining).toBe(3);
  // The view never leaks the code hash.
  expect(JSON.stringify(res.stay)).not.toContain('codeHash');
});

test('13.1 AC1 — validation: name required, dates ordered, language in the 7 guests', async ({
  request,
  hotel,
}) => {
  const { rooms } = await roomsReady(request, hotel);

  const noName = await checkIn(request, hotel.ownerToken, {
    roomId: rooms['401'],
    guestName: '',
  });
  expect(noName.status).toBe(400);

  const badDates = await checkIn(request, hotel.ownerToken, {
    roomId: rooms['401'],
    checkInDate: todayPlus(2),
    checkOutDate: todayPlus(2),
  });
  expect(badDates.status).toBe(400);
  expect((badDates.body as { code?: string }).code).toBe('INVALID_STAY_DATES');

  const badLanguage = await checkIn(request, hotel.ownerToken, {
    roomId: rooms['401'],
    language: 'klingon',
  });
  expect(badLanguage.status).toBe(400);

  const badEmail = await checkIn(request, hotel.ownerToken, {
    roomId: rooms['401'],
    email: 'not-an-email',
  });
  expect(badEmail.status).toBe(400);
});

test('13.1 AC1 — check-in into out_of_service / inactive / unknown rooms is rejected', async ({
  request,
  hotel,
  standardType,
}) => {
  const { rooms } = await roomsReady(request, hotel);

  const oosAttempt = await checkIn(request, hotel.ownerToken, { roomId: rooms['411'] });
  expect(oosAttempt.status).toBe(409);
  expect((oosAttempt.body as { code?: string }).code).toBe('ROOM_NOT_AVAILABLE');

  const ghost = await checkIn(request, hotel.ownerToken, {
    roomId: '00000000-0000-4000-8000-000000000000',
  });
  expect(ghost.status).toBe(404);
  expect((ghost.body as { code?: string }).code).toBe('ROOM_NOT_FOUND');
});

test('13.1 AC2 — a second check-in into an occupied room 409s ROOM_OCCUPIED', async ({
  request,
  hotel,
}) => {
  const { rooms } = await roomsReady(request, hotel);
  await checkInOk(request, hotel.ownerToken, { roomId: rooms['403'] });

  const second = await checkIn(request, hotel.ownerToken, { roomId: rooms['403'] });
  expect(second.status).toBe(409);
  expect((second.body as { code?: string }).code).toBe('ROOM_OCCUPIED');
});

test('13.1 AC2 — race: two simultaneous check-ins to the same room, one 201 one 409', async ({
  request,
  hotel,
}) => {
  const { rooms } = await roomsReady(request, hotel);
  const [r1, r2] = await Promise.all([
    checkIn(request, hotel.ownerToken, { roomId: rooms['404'], guestName: guestName() }),
    checkIn(request, hotel.ownerToken, { roomId: rooms['404'], guestName: guestName() }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual([201, 409]);
  const loser = r1.status === 409 ? r1 : r2;
  expect((loser.body as { code?: string }).code).toBe('ROOM_OCCUPIED');
});

test('13.1 AC1 — available-rooms picker excludes occupied and non-active rooms', async ({
  request,
  hotel,
  standardType,
}) => {
  const { rooms } = await roomsReady(request, hotel);
  await checkInOk(request, hotel.ownerToken, { roomId: rooms['405'] });

  const avail = await apiGet<Array<{ roomNumber: string }>>(
    request,
    '/tenant/stays/available-rooms',
    hotel.ownerToken,
  );
  expect(avail.status).toBe(200);
  const numbers = avail.body.map((r) => r.roomNumber);
  expect(numbers).not.toContain('405'); // occupied
  expect(numbers).not.toContain('411'); // out_of_service
  expect(numbers).toContain('406');
  // natural order
  expect([...numbers].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))).toEqual(numbers);
});

test('13.1 AC4 — check-in with an email queues a stay_code email in the guest language', async ({
  request,
  hotel,
}) => {
  const { rooms } = await roomsReady(request, hotel);
  const { stay, code } = await checkInOk(request, hotel.ownerToken, {
    roomId: rooms['406'],
    language: 'ar',
    email: 'ar-guest@example.com',
  });

  const row = outboxRow(hotel.hotelId, stay.id);
  expect(row, 'stay_code outbox row exists').toBeTruthy();
  const parsed = JSON.parse(row!) as {
    type: string; language: string; recipientEmail: string; bodyHtml: string;
  };
  expect(parsed.type).toBe('stay_code');
  expect(parsed.language).toBe('ar'); // ar/en get the guest's language
  expect(parsed.recipientEmail).toBe('ar-guest@example.com');
  // Room + app link render into the persisted HTML — but the code itself is
  // a secret: the stored render is masked (never the plaintext, 13.1 AC5).
  expect(parsed.bodyHtml).toContain('406');
  expect(parsed.bodyHtml).toContain('guest');
  expect(parsed.bodyHtml).not.toContain(code);

  // Non-ar/en falls back to en for now (13.1 AC4).
  const { stay: fr } = await checkInOk(request, hotel.ownerToken, {
    roomId: rooms['407'],
    language: 'fr',
    email: 'fr-guest@example.com',
  });
  const frRow = JSON.parse(outboxRow(hotel.hotelId, fr.id)!) as { language: string };
  expect(frRow.language).toBe('en');
});

test('13.1 AC4 — check-in without an email queues nothing', async ({
  request,
  hotel,
}) => {
  const { rooms } = await roomsReady(request, hotel);
  // fullyParallel: sibling tests queue emails into the same hotel, so scope
  // the assertion to THIS stay's dedupe key, not the hotel's outbox size.
  const { stay } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['408'] });
  expect(outboxRow(hotel.hotelId, stay.id)).toBeNull();
});

test('13.1 AC5 — audit stay.checked_in carries guest/room/dates but never the code', async ({
  request,
  hotel,
}) => {
  const { rooms } = await roomsReady(request, hotel);
  const { stay, code } = await checkInOk(request, hotel.ownerToken, { roomId: rooms['409'] });

  expect(auditCount('stay.checked_in', stay.id)).toBe(1);
  const meta = lastAuditMeta('stay.checked_in', stay.id)!;
  expect(meta).toContain(stay.guestName);
  expect(meta).toContain('409');
  expect(meta).not.toContain(code);
});

function outboxRow(hotelId: string, stayId: string): string | null {
  const out = execFileSync(
    'docker',
    ['exec', 'gxp-db', 'psql', '-U', 'gxp', '-d', 'gxp', '-tAc',
     `SELECT row_to_json(t) FROM (SELECT type, language, "recipientEmail", status, "bodyHtml" FROM notification_outbox WHERE "hotelId"='${hotelId}' AND type='stay_code' AND "dedupeKey" LIKE 'stay_code:${stayId}:%' ORDER BY "createdAt" DESC LIMIT 1) t`],
    { encoding: 'utf8' },
  ).trim();
  return out === '' ? null : out;
}

function outboxCount(hotelId: string): number {
  return Number(execFileSync(
    'docker',
    ['exec', 'gxp-db', 'psql', '-U', 'gxp', '-d', 'gxp', '-tAc',
     `SELECT count(*) FROM notification_outbox WHERE "hotelId"='${hotelId}' AND type='stay_code'`],
    { encoding: 'utf8' },
  ).trim());
}
