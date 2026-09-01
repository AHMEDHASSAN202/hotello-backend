/**
 * Epic 13 — Story 13.5 AC3: layered brute-force protection.
 *
 * Runs against its OWN dedicated hotel (lockouts + the per-hotel window would
 * poison every other guest-login test). Failure accounting is exact: 5 + 4 +
 * 8 recorded failures in the first three tests, then exactly 13 more in the
 * hotel-layer test = the 30/hour hotel limit. Generic 429s (the shared route
 * @Throttle) are retried and never counted — they never reach the service.
 */
import { expect, test } from '../../fixtures';
import {
  apiPost,
  createRoomsQuickly,
  provisionHotel,
  standardTypeId,
  type ProvisionedHotel,
} from '../../helpers/gxp-api';
import { checkInOk } from '../../helpers/stays';

// The failure-accounting math requires strict order.
test.describe.configure({ mode: 'serial' });

let dedicated: ProvisionedHotel;
let rooms: Record<string, string> = {};

test.beforeAll(async ({ request, adminToken }) => {
  dedicated = await provisionHotel(request, { epic: 'e13', tag: `rl${Date.now().toString(36)}`, adminToken });
  const type = await standardTypeId(request, dedicated.ownerToken);
  await createRoomsQuickly(request, dedicated.ownerToken, type, ['101', '102', '103', '104', '105', '201', '202', '203'], 1);
  const res = await request.get(`${process.env.GXP_API_URL ?? 'http://localhost:4000/api/v1'}/tenant/rooms?pageSize=100`, {
    headers: { Authorization: `Bearer ${dedicated.ownerToken}` },
  });
  const body = (await res.json()) as { data: Array<{ id: string; roomNumber: string }> };
  for (const room of body.data) rooms[room.roomNumber] = room.id;
});

interface AttemptResult {
  status: number;
  code?: string;
  retryAfterSeconds?: number;
}

/** One session attempt; distinguishes the service's 429 from the route throttle. */
async function attempt(
  req: Parameters<typeof apiPost>[0],
  roomNumber: string,
  code: string,
): Promise<AttemptResult> {
  const res = await apiPost(req, `/guest/${dedicated.slug}/session`, { roomNumber, code });
  const body = res.body as { code?: string; retryAfterSeconds?: number };
  return { status: res.status, code: body.code, retryAfterSeconds: body.retryAfterSeconds };
}

/**
 * Poll until the service's OWN 429 (code TOO_MANY_ATTEMPTS) shows up — a
 * generic route-throttle 429 never carries the code and just means the shared
 * /guest 30/min window is busy.
 */
async function expectServiceLockout(
  req: Parameters<typeof apiPost>[0],
  roomNumber: string,
  code: string,
): Promise<AttemptResult> {
  for (;;) {
    const res = await attempt(req, roomNumber, code);
    if (res.status === 429 && res.code === 'TOO_MANY_ATTEMPTS') return res;
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

/**
 * A failure attempt that MUST be recorded by the service (401 INVALID_CODE or
 * a service TOO_MANY_ATTEMPTS). A generic route-throttle 429 doesn't reach the
 * service — wait for the route window and retry so accounting stays exact.
 */
async function recordedFailure(
  req: Parameters<typeof apiPost>[0],
  roomNumber: string,
): Promise<AttemptResult> {
  for (;;) {
    const res = await attempt(req, roomNumber, '000000');
    process.stdout.write(`[rl] burn ${roomNumber} -> ${res.status} ${res.code ?? ''}\n`);
    if (res.status === 401) return res;
    if (res.status === 429 && res.code === 'TOO_MANY_ATTEMPTS') return res;
    // Generic route-throttle 429 — wait out the minute window.
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

test('13.5 AC3 — 5 wrong attempts lock the room; correct code refused during lockout', async ({ request }) => {
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['101'] });

  for (let i = 0; i < 5; i++) {
    const res = await recordedFailure(request, '101');
    if (res.status === 429) {
      expect(res.code).toBe('TOO_MANY_ATTEMPTS');
      expect(res.retryAfterSeconds).toBeGreaterThan(0);
    } else {
      expect(res.code).toBe('INVALID_CODE');
    }
  }

  // Now the room must be locked: even the CORRECT code is refused, with a
  // retry-after (13.5 AC3 lockout shape).
  const locked = await expectServiceLockout(request, '101', code);
  expect(locked.retryAfterSeconds).toBeGreaterThan(0);
});

test('13.5 AC3 — a different room from the same IP is unaffected (per-room layer)', async ({ request }) => {
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['102'] });
  for (let i = 0; i < 4; i++) {
    const res = await recordedFailure(request, '102');
    expect(res.status).toBe(401);
  }
  const ok = await attempt(request, '102', code);
  expect(ok.status).toBe(200);
});

test('13.5 AC3 — a successful login clears the room failure/lockout state', async ({ request }) => {
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['103'] });
  for (let i = 0; i < 4; i++) await recordedFailure(request, '103');
  expect((await attempt(request, '103', code)).status).toBe(200);
  for (let i = 0; i < 4; i++) await recordedFailure(request, '103');
  expect((await attempt(request, '103', code)).status).toBe(200);
});

test('13.5 AC3 — per-hotel layer: 30 failures/hour block even valid logins', async ({ request }) => {
  // Room 203 hosts the canary login; 4 failures per room never trip the
  // per-room 5-fail lockout, so every burn lands in the hotel-level window.
  const { code } = await checkInOk(request, dedicated.ownerToken, { roomId: rooms['203'] });

  // Recorded failures so far: 5 (101) + 4 (102) + 8 (103) = 17. Add exactly
  // 13 (4+4+4+1) to reach the 30/hour hotel limit.
  for (const room of ['104', '105', '201', '202']) {
    const times = room === '202' ? 1 : 4;
    for (let i = 0; i < times; i++) await recordedFailure(request, room);
  }

  // The hotel layer now refuses EVERYTHING from this IP — valid code included.
  const blocked = await expectServiceLockout(request, '203', code);
  expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
});
