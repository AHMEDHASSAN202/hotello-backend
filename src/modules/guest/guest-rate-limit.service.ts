import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface HotelWindow {
  count: number;
  windowStart: number;
}

interface RoomWindow extends HotelWindow {
  lockedUntil: number;
  /** Consecutive lockouts — drives the escalating duration. */
  lockouts: number;
}

/**
 * 13.5 AC3 — layered brute-force protection for guest session entry (codes
 * are 6 digits, so this is the primary defense):
 *
 * - per IP+room: N attempts inside a window, then a temporary lockout whose
 *   duration doubles with each consecutive lockout (base·2^(n−1), capped).
 * - per IP+hotel: a fixed window across ALL rooms — blocks room-scanning.
 *
 * In-memory per instance (acceptable now — spec note 3); the store is
 * contained in this one service so a Redis swap later touches nothing else.
 * Lockouts log warnings for future alerting.
 */
@Injectable()
export class GuestRateLimitService {
  private readonly logger = new Logger(GuestRateLimitService.name);
  private readonly rooms = new Map<string, RoomWindow>();
  private readonly hotels = new Map<string, HotelWindow>();

  private readonly roomLimit: number;
  private readonly roomWindowMs: number;
  private readonly lockoutBaseMs: number;
  private readonly lockoutMaxMs: number;
  private readonly hotelLimit: number;
  private readonly hotelWindowMs: number;

  constructor(config: ConfigService) {
    const num = (key: string, fallback: string) =>
      parseInt(config.get(key, fallback), 10);
    this.roomLimit = num('GUEST_LOGIN_ROOM_LIMIT', '5');
    this.roomWindowMs = num('GUEST_LOGIN_ROOM_WINDOW_MS', '900000');
    this.lockoutBaseMs = num('GUEST_LOGIN_ROOM_LOCKOUT_BASE_MS', '900000');
    this.lockoutMaxMs = num('GUEST_LOGIN_ROOM_LOCKOUT_MAX_MS', '86400000');
    this.hotelLimit = num('GUEST_LOGIN_HOTEL_LIMIT', '30');
    this.hotelWindowMs = num('GUEST_LOGIN_HOTEL_WINDOW_MS', '3600000');
  }

  /** Throws 429 TOO_MANY_ATTEMPTS (with retry-after) when a layer blocks. */
  assertAllowed(
    ip: string,
    hotelId: string,
    roomKey: string,
    now = Date.now(),
  ): void {
    const room = this.rooms.get(this.roomKey(ip, hotelId, roomKey));
    if (room && room.lockedUntil > now) {
      throw this.tooManyAttempts(room.lockedUntil - now);
    }
    const hotel = this.hotels.get(this.hotelKey(ip, hotelId));
    if (
      hotel &&
      now - hotel.windowStart < this.hotelWindowMs &&
      hotel.count >= this.hotelLimit
    ) {
      throw this.tooManyAttempts(hotel.windowStart + this.hotelWindowMs - now);
    }
  }

  recordFailure(
    ip: string,
    hotelId: string,
    roomKey: string,
    now = Date.now(),
  ): void {
    // Hotel layer — fixed window across all rooms (room-scanning).
    const hk = this.hotelKey(ip, hotelId);
    const hotel = this.hotels.get(hk);
    if (!hotel || now - hotel.windowStart >= this.hotelWindowMs) {
      this.hotels.set(hk, { count: 1, windowStart: now });
    } else {
      hotel.count += 1;
    }

    // Room layer — windowed count, escalating lockout.
    const rk = this.roomKey(ip, hotelId, roomKey);
    let room = this.rooms.get(rk);
    if (!room) {
      room = { count: 0, windowStart: now, lockedUntil: 0, lockouts: 0 };
      this.rooms.set(rk, room);
    }
    if (now - room.windowStart >= this.roomWindowMs) {
      // New window — attempts reset, the escalation counter survives.
      room.count = 0;
      room.windowStart = now;
    }
    room.count += 1;
    if (room.count >= this.roomLimit) {
      room.lockouts += 1;
      const duration = Math.min(
        this.lockoutBaseMs * 2 ** (room.lockouts - 1),
        this.lockoutMaxMs,
      );
      room.lockedUntil = now + duration;
      room.count = 0;
      room.windowStart = now;
      // Logged (never with the attempted code) for future alerting (AC3).
      this.logger.warn(
        `Guest login lockout: hotel=${hotelId} room=${roomKey} ip=${ip} lockout#${room.lockouts} for ${Math.round(duration / 1000)}s`,
      );
    }
  }

  /** A successful login clears the room's failure/lockout state. */
  recordSuccess(ip: string, hotelId: string, roomKey: string): void {
    this.rooms.delete(this.roomKey(ip, hotelId, roomKey));
  }

  private tooManyAttempts(retryAfterMs: number): HttpException {
    return new HttpException(
      {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many attempts — try again later',
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private roomKey(ip: string, hotelId: string, roomKey: string): string {
    return `${ip}|${hotelId}|${roomKey}`;
  }

  private hotelKey(ip: string, hotelId: string): string {
    return `${ip}|${hotelId}`;
  }
}
