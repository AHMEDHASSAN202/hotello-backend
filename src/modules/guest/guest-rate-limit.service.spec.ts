import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GuestRateLimitService } from './guest-rate-limit.service';

const MIN = 60_000;

/** Defaults: room 5/15min, lockout base 15min (cap 24h), hotel 30/hour. */
const makeService = () =>
  new GuestRateLimitService({
    get: (_key: string, fallback: string) => fallback,
  } as unknown as ConfigService);

const record = (
  service: GuestRateLimitService,
  times: number,
  now: number,
  room = '101',
  ip = '1.2.3.4',
) => {
  for (let i = 0; i < times; i += 1) {
    service.recordFailure(ip, 'hotel-1', room, now);
  }
};

/** Runs assertAllowed expecting the 429 and returns its response body. */
const expectBlocked = (
  service: GuestRateLimitService,
  now: number,
  room = '101',
  ip = '1.2.3.4',
): { code: string; retryAfterSeconds: number } => {
  try {
    service.assertAllowed(ip, 'hotel-1', room, now);
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toEqual(429);
    return (err as HttpException).getResponse() as {
      code: string;
      retryAfterSeconds: number;
    };
  }
  throw new Error('expected assertAllowed to throw TOO_MANY_ATTEMPTS');
};

describe('GuestRateLimitService (13.5 AC3)', () => {
  it('allows attempts under both limits', () => {
    const service = makeService();
    const now = 1_000_000;
    record(service, 4, now);
    expect(() =>
      service.assertAllowed('1.2.3.4', 'hotel-1', '101', now),
    ).not.toThrow();
  });

  it('locks the IP+room after the limit with a retry-after', () => {
    const service = makeService();
    const now = 1_000_000;
    record(service, 5, now);

    const blocked = expectBlocked(service, now);
    expect(blocked.code).toEqual('TOO_MANY_ATTEMPTS');
    expect(blocked.retryAfterSeconds).toEqual(15 * 60);

    // Other rooms (same IP) and other IPs (same room) stay open — room layer.
    expect(() =>
      service.assertAllowed('1.2.3.4', 'hotel-1', '102', now),
    ).not.toThrow();
    expect(() =>
      service.assertAllowed('9.9.9.9', 'hotel-1', '101', now),
    ).not.toThrow();
  });

  it('escalates the lockout duration on repeated lockouts, capped at 24h', () => {
    const service = makeService();
    let now = 1_000_000;

    record(service, 5, now); // lockout #1 — 15 min
    now += 16 * MIN;
    record(service, 5, now); // lockout #2 — 30 min
    expect(expectBlocked(service, now).retryAfterSeconds).toEqual(30 * 60);

    // Push the escalation past the cap: base·2^(n−1) ≥ 24h from n=8.
    for (let lockout = 3; lockout <= 10; lockout += 1) {
      now += 25 * 60 * MIN;
      record(service, 5, now);
    }
    expect(expectBlocked(service, now).retryAfterSeconds).toEqual(24 * 60 * 60);
  });

  it('the per-hotel layer blocks room-scanning across many rooms', () => {
    const service = makeService();
    const now = 1_000_000;
    for (let i = 0; i < 30; i += 1) {
      record(service, 1, now, `room-${i}`);
    }
    const blocked = expectBlocked(service, now, 'room-31');
    expect(blocked.code).toEqual('TOO_MANY_ATTEMPTS');
    expect(blocked.retryAfterSeconds).toEqual(60 * 60);

    // A different hotel from the same IP is unaffected.
    expect(() =>
      service.assertAllowed('1.2.3.4', 'hotel-2', '101', now),
    ).not.toThrow();
  });

  it('failure windows expire instead of accumulating forever', () => {
    const service = makeService();
    let now = 1_000_000;
    record(service, 4, now);
    now += 16 * MIN; // 15-min room window expired
    record(service, 4, now);
    expect(() =>
      service.assertAllowed('1.2.3.4', 'hotel-1', '101', now),
    ).not.toThrow();
  });

  it('a successful login clears the room failure state', () => {
    const service = makeService();
    const now = 1_000_000;
    record(service, 4, now);
    service.recordSuccess('1.2.3.4', 'hotel-1', '101');
    record(service, 4, now);
    expect(() =>
      service.assertAllowed('1.2.3.4', 'hotel-1', '101', now),
    ).not.toThrow();
  });
});
