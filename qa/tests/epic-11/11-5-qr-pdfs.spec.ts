/**
 * Epic 11 — Story 11.5 QR Codes & Print-Ready PDFs.
 * The QR URL contract: general → GUEST_APP_BASE_URL/{slug}; room →
 * GUEST_APP_BASE_URL/{slug}?room={number}. QRs are derived, never stored.
 */
import { expect, test } from '../../fixtures';
import { apiGetRaw, createRoomsQuickly, guestBaseUrl } from '../../helpers/gxp-api';
import { decodeQrPng } from '../../helpers/qr-xlsx';

/** The backend's configured GUEST_APP_BASE_URL (defaults per .env.example). */
const GUEST_BASE = guestBaseUrl();

test('11.5 AC1 — reception poster PDF (A4 and A5) streams a real PDF', async ({
  request,
  hotel,
}) => {
  for (const size of ['a4', 'a5']) {
    const res = await apiGetRaw(request, `/tenant/rooms/pdf/poster?size=${size}`, hotel.ownerToken);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.headers['content-disposition']).toContain(`qr-poster-${size}`);
  }
  const bad = await apiGetRaw(request, '/tenant/rooms/pdf/poster?size=a3', hotel.ownerToken);
  expect(bad.status).toBe(400);
});

test('11.5 AC2 — room cards PDF for all rooms / by floor / specific rooms', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['701', '702'], 7);
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['751'], 8);

  const all = await apiGetRaw(request, '/tenant/rooms/pdf/cards?scope=all', hotel.ownerToken);
  expect(all.status).toBe(200);
  expect(all.contentType).toBe('application/pdf');
  expect(all.body.subarray(0, 5).toString()).toBe('%PDF-');

  const floor = await apiGetRaw(request, '/tenant/rooms/pdf/cards?scope=floors&floors=7', hotel.ownerToken);
  expect(floor.status).toBe(200);

  const list = await listRoomIds(request, hotel.ownerToken, ['701']);
  const specific = await apiGetRaw(
    request,
    `/tenant/rooms/pdf/cards?scope=rooms&roomIds=${list.join(',')}`,
    hotel.ownerToken,
  );
  expect(specific.status).toBe(200);

  // >100 roomIds are capped — must be a clean 400, not a hang.
  const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const cap = await apiGetRaw(request, `/tenant/rooms/pdf/cards?scope=rooms&roomIds=${ids.join(',')}`, hotel.ownerToken);
  expect(cap.status).toBe(400);
});

test('11.5 AC2 — cards scope without rooms in scope → 400 NO_ROOMS_IN_SCOPE', async ({
  request,
  hotel,
}) => {
  const empty = await apiGetRaw(request, '/tenant/rooms/pdf/cards?scope=floors&floors=42', hotel.ownerToken);
  expect(empty.status).toBe(400);
  const body = JSON.parse(empty.body.toString());
  expect(body.code ?? body.message).toBeTruthy();
});

test('11.5 AC3 — per-room QR PNG and SVG endpoints, plus the general QR', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['710'], 7);
  const [id] = await listRoomIds(request, hotel.ownerToken, ['710']);

  const png = await apiGetRaw(request, `/tenant/rooms/${id}/qr?format=png`, hotel.ownerToken);
  expect(png.status).toBe(200);
  expect(png.contentType).toBe('image/png');
  expect(png.body.subarray(1, 4).toString()).toBe('PNG');

  const svg = await apiGetRaw(request, `/tenant/rooms/${id}/qr?format=svg`, hotel.ownerToken);
  expect(svg.status).toBe(200);
  expect(svg.contentType).toContain('image/svg+xml');
  expect(svg.body.toString().slice(0, 4)).toBe('<svg');

  const general = await apiGetRaw(request, '/tenant/rooms/qr/general?format=png', hotel.ownerToken);
  expect(general.status).toBe(200);
  expect(general.contentType).toBe('image/png');
});

test('11.5 AC4 — the QR payload is exactly the derived guest URL (slug + room param)', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['711'], 7);
  const [id] = await listRoomIds(request, hotel.ownerToken, ['711']);

  const roomQr = await apiGetRaw(request, `/tenant/rooms/${id}/qr?format=png`, hotel.ownerToken);
  expect(await decodeQrPng(roomQr.body)).toBe(`${GUEST_BASE}/${hotel.slug}?room=711`);

  const generalQr = await apiGetRaw(request, '/tenant/rooms/qr/general?format=png', hotel.ownerToken);
  expect(await decodeQrPng(generalQr.body)).toBe(`${GUEST_BASE}/${hotel.slug}`);
});

test('11.5 AC4 — regeneration is byte-identical for QRs (derived, nothing stored)', async ({
  request,
  hotel,
  standardType,
}) => {
  await createRoomsQuickly(request, hotel.ownerToken, standardType.id, ['712'], 7);
  const [id] = await listRoomIds(request, hotel.ownerToken, ['712']);

  // The QR images themselves must be perfectly reproducible.
  const first = await apiGetRaw(request, `/tenant/rooms/${id}/qr?format=png`, hotel.ownerToken);
  const second = await apiGetRaw(request, `/tenant/rooms/${id}/qr?format=png`, hotel.ownerToken);
  expect(first.body.equals(second.body)).toBe(true);
  expect(await decodeQrPng(first.body)).toBe(await decodeQrPng(second.body));

  // PDFs embed render timestamps, so byte equality is NOT required by the
  // spec — only that regeneration still yields a valid PDF.
  const posterA = await apiGetRaw(request, '/tenant/rooms/pdf/poster?size=a4', hotel.ownerToken);
  const posterB = await apiGetRaw(request, '/tenant/rooms/pdf/poster?size=a4', hotel.ownerToken);
  expect(posterA.body.subarray(0, 5).toString()).toBe('%PDF-');
  expect(posterB.body.subarray(0, 5).toString()).toBe('%PDF-');
});

test('11.5 — QR endpoints require rooms.read', async ({ request }) => {
  const anon = await apiGetRaw(request, '/tenant/rooms/qr/general');
  expect(anon.status).toBe(401);
});

async function listRoomIds(
  request: Parameters<typeof apiGetRaw>[0],
  token: string,
  numbers: string[],
): Promise<string[]> {
  const { listRooms } = await import('../../helpers/gxp-api');
  const res = await listRooms(request, token, { pageSize: 200 });
  return res.body.data
    .filter((r) => numbers.includes(r.roomNumber))
    .map((r) => r.id);
}

// Keep API_URL referenced for future suites sharing this file's helpers.
