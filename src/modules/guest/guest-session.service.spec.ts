import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { StayCodeService } from '../tenant-stays/stay-code.service';
import { Stay } from '../tenant-stays/stay.entity';
import { GuestRateLimitService } from './guest-rate-limit.service';
import { GuestSessionService } from './guest-session.service';

const futureDate = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const HOTEL = {
  id: 'hotel-1',
  slug: 'sunrise',
  status: 'active',
  nameEn: 'Sunrise',
  nameAr: 'شروق',
} as unknown as Hotel;

const makeStay = (o: Record<string, unknown> = {}) =>
  ({
    id: 'stay-1',
    hotelId: 'hotel-1',
    roomId: 'room-1',
    guestName: 'Ahmed Ali',
    language: 'ar',
    status: 'active',
    stayType: 'all_inclusive',
    checkOutDate: futureDate(3),
    room: { id: 'room-1', roomNumber: '101' },
    ...o,
  }) as unknown as Stay;

describe('GuestSessionService (13.5)', () => {
  let service: GuestSessionService;
  let staysRepo: { findOne: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let stayCodes: { hash: jest.Mock };
  let rateLimit: {
    assertAllowed: jest.Mock;
    recordFailure: jest.Mock;
    recordSuccess: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    staysRepo = { findOne: jest.fn().mockResolvedValue(makeStay()) };
    hotelsRepo = { findOne: jest.fn().mockResolvedValue({ ...HOTEL }) };
    stayCodes = { hash: jest.fn((code: string) => `hmac:${code}`) };
    rateLimit = {
      assertAllowed: jest.fn(),
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('guest-token') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestSessionService,
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: StayCodeService, useValue: stayCodes },
        { provide: GuestRateLimitService, useValue: rateLimit },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_k: string, fallback: string) => fallback),
            getOrThrow: jest.fn(() => 'guest-secret'),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(GuestSessionService);
  });

  const dto = { roomNumber: '101', code: '123456' };

  describe('createSession', () => {
    it('AC2 — unknown or inactive slug is a 404', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createSession('ghost', dto as never, '1.1.1.1'),
      ).rejects.toBeInstanceOf(NotFoundException);

      hotelsRepo.findOne.mockResolvedValue({ ...HOTEL, status: 'inactive' });
      await expect(
        service.createSession('sunrise', dto as never, '1.1.1.1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('AC2 — suspended hotel is HOTEL_UNAVAILABLE, checked before any code work', async () => {
      hotelsRepo.findOne.mockResolvedValue({ ...HOTEL, status: 'suspended' });
      await expect(
        service.createSession('sunrise', dto as never, '1.1.1.1'),
      ).rejects.toMatchObject({
        constructor: ForbiddenException,
        response: { code: 'HOTEL_UNAVAILABLE' },
      });
      expect(staysRepo.findOne).not.toHaveBeenCalled();
    });

    it('AC2 — wrong code and wrong room produce the SAME generic 401 (no enumeration)', async () => {
      // Wrong code: hash matches no active stay.
      staysRepo.findOne.mockResolvedValueOnce(null);
      const wrongCode = await service
        .createSession('sunrise', dto as never, '1.1.1.1')
        .catch((e) => e);

      // Wrong room: code exists but is bound to another room.
      staysRepo.findOne.mockResolvedValueOnce(
        makeStay({ room: { id: 'room-2', roomNumber: '202' } }),
      );
      const wrongRoom = await service
        .createSession('sunrise', dto as never, '1.1.1.1')
        .catch((e) => e);

      for (const err of [wrongCode, wrongRoom]) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        expect(err.getResponse()).toEqual({
          code: 'INVALID_CODE',
          message: 'Invalid room or code',
        });
      }
      expect(rateLimit.recordFailure).toHaveBeenCalledTimes(2);
    });

    it('AC3 — the limiter gates the attempt before any lookup', async () => {
      rateLimit.assertAllowed.mockImplementation(() => {
        throw new Error('blocked');
      });
      await expect(
        service.createSession('sunrise', dto as never, '1.1.1.1'),
      ).rejects.toThrow('blocked');
      expect(staysRepo.findOne).not.toHaveBeenCalled();
    });

    it('AC1 — success returns a guest-audience token + minimal profile and resets the limiter', async () => {
      const result = await service.createSession(
        'sunrise',
        dto as never,
        '1.1.1.1',
      );

      expect(result.accessToken).toEqual('guest-token');
      expect(result.profile).toEqual({
        guestName: 'Ahmed Ali',
        roomNumber: '101',
        hotelNameEn: 'Sunrise',
        hotelNameAr: 'شروق',
        slug: 'sunrise',
        language: 'ar',
        checkOutDate: futureDate(3),
        // 16.1 AC4 — the Guest App prices menus from the session alone.
        stayType: 'all_inclusive',
        // Epic 16 — client cart is keyed per stay (spec note 9).
        stayId: 'stay-1',
        // Epic 20, 20.4 — the DND switch state rides the profile envelope.
        dndActive: false,
      });
      // Lookup is O(1) by (hotelId, codeHash) among active stays.
      expect(staysRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            hotelId: 'hotel-1',
            codeHash: 'hmac:123456',
            status: 'active',
          },
        }),
      );
      const [payload, options] = jwtService.signAsync.mock.calls[0];
      expect(payload).toEqual({
        sub: 'stay-1',
        hotelId: 'hotel-1',
        language: 'ar',
      });
      expect(options).toMatchObject({
        secret: 'guest-secret',
        audience: 'guest',
      });
      // AC4 — expiry backstop ≈ checkout + 1 day buffer (never > max TTL).
      expect(options.expiresIn).toBeGreaterThan(3 * 24 * 3600);
      expect(options.expiresIn).toBeLessThanOrEqual(5 * 24 * 3600);
      expect(rateLimit.recordSuccess).toHaveBeenCalled();
    });

    it('AC5 — multi-device: repeated logins with the same code all succeed', async () => {
      staysRepo.findOne.mockResolvedValue(makeStay());
      await service.createSession('sunrise', dto as never, '1.1.1.1');
      await service.createSession('sunrise', dto as never, '2.2.2.2');
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    });

    it('normalizes the room number before matching ("101a " → "101A")', async () => {
      staysRepo.findOne.mockResolvedValue(
        makeStay({ room: { id: 'room-1', roomNumber: '101A' } }),
      );
      const result = await service.createSession(
        'sunrise',
        { roomNumber: ' 101a ', code: '123456' } as never,
        '1.1.1.1',
      );
      expect(result.profile.roomNumber).toEqual('101A');
    });
  });
});
