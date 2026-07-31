import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { NOTIFICATION_EVENTS } from '../notifications/notification-events';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantAuthService } from './tenant-auth.service';
import { TenantTokenService } from './tenant-token.service';

jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('TenantAuthService', () => {
  let service: TenantAuthService;
  let usersRepo: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let jwt: { verifyAsync: jest.Mock };
  let tokens: { issueTokens: jest.Mock; publicUser: jest.Mock };
  let audit: { log: jest.Mock };
  let events: { emitAsync: jest.Mock };

  const makeHotel = (o: Partial<Hotel> = {}): Hotel =>
    ({ id: 'hotel-1', slug: 'sunrise', status: 'active', ...o }) as Hotel;

  const makeUser = (o: Partial<TenantUser> = {}): TenantUser =>
    ({
      id: 'user-1',
      hotelId: 'hotel-1',
      name: 'Owner',
      email: 'owner@sunrise.com',
      roleId: 'role-owner',
      role: {
        id: 'role-owner',
        nameEn: 'Owner',
        nameAr: 'المالك',
        isSystem: true,
        permissions: ['*'],
      },
      status: 'active',
      passwordHash: 'stored-hash',
      refreshTokenHash: 'stored-refresh-hash',
      preferredLanguage: null,
      ...o,
    }) as TenantUser;

  beforeEach(async () => {
    usersRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (u) => u),
      update: jest.fn(),
    };
    hotelsRepo = { findOne: jest.fn() };
    jwt = { verifyAsync: jest.fn() };
    tokens = {
      issueTokens: jest
        .fn()
        .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
      publicUser: jest.fn((u) => ({ id: u.id, email: u.email })),
    };
    audit = { log: jest.fn() };
    events = { emitAsync: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantAuthService,
        { provide: getRepositoryToken(TenantUser), useValue: usersRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 's',
            get: (_k: string, d?: string) => d ?? 's',
          },
        },
        { provide: TenantTokenService, useValue: tokens },
        { provide: AuditLogsService, useValue: audit },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = moduleRef.get(TenantAuthService);
    mockedBcrypt.compare.mockReset();
    (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
  });

  describe('login (8.3)', () => {
    it('AC1 — authenticates within the resolved tenant and returns tokens + user + hotel', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      usersRepo.findOne.mockResolvedValue(makeUser());
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        slug: 'sunrise',
        identifier: 'owner@sunrise.com',
        password: 'pw',
      });

      // An `@`-shaped identifier is matched by email, scoped to the hotel.
      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1', email: 'owner@sunrise.com' },
        relations: ['role'],
      });
      expect(result).toMatchObject({
        accessToken: 'at',
        refreshToken: 'rt',
        hotel: { slug: 'sunrise' },
      });
      expect(tokens.issueTokens).toHaveBeenCalled();
    });

    it('AC1 — a non-@ identifier is matched by username', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      usersRepo.findOne.mockResolvedValue(makeUser({ username: 'frontdesk1' }));
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login({
        slug: 'sunrise',
        identifier: 'frontdesk1',
        password: 'pw',
      });

      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1', username: 'frontdesk1' },
        relations: ['role'],
      });
    });

    it('AC5 — records lastLoginAt', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      const user = makeUser({ lastLoginAt: null });
      usersRepo.findOne.mockResolvedValue(user);
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login({ slug: 'sunrise', identifier: 'owner@sunrise.com', password: 'pw' });

      expect(user.lastLoginAt).toBeInstanceOf(Date);
    });

    it('AC1 — unknown slug yields the same generic 401 (no enumeration)', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.login({ slug: 'nope', identifier: 'x@y.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(usersRepo.findOne).not.toHaveBeenCalled();
    });

    it('AC2 — wrong password yields the same generic 401', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      usersRepo.findOne.mockResolvedValue(makeUser());
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.login({ slug: 'sunrise', identifier: 'owner@sunrise.com', password: 'bad' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('AC2 — pending user cannot log in (generic 401)', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      usersRepo.findOne.mockResolvedValue(makeUser({ status: 'pending' }));
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(
        service.login({ slug: 'sunrise', identifier: 'owner@sunrise.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('AC2 — disabled user cannot log in (generic 401)', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      usersRepo.findOne.mockResolvedValue(makeUser({ status: 'disabled' }));
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(
        service.login({ slug: 'sunrise', identifier: 'owner@sunrise.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('AC2 — users of a suspended hotel cannot log in (403 HOTEL_SUSPENDED)', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel({ status: 'suspended' }));
      await expect(
        service.login({ slug: 'sunrise', identifier: 'owner@sunrise.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(usersRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('refresh (8.5)', () => {
    it('rotates tokens for a valid, matching refresh token', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      usersRepo.findOne.mockResolvedValue(makeUser({ hotel: makeHotel() }));
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.refresh('rt');
      expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt' });
    });

    it('rejects a rotated-out / forged refresh token (401)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      usersRepo.findOne.mockResolvedValue(makeUser({ hotel: makeHotel() }));
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.refresh('rt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when no stored hash (logged out)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      usersRepo.findOne.mockResolvedValue(
        makeUser({ refreshTokenHash: null, hotel: makeHotel() }),
      );
      await expect(service.refresh('rt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when the hotel is now suspended (403)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      usersRepo.findOne.mockResolvedValue(
        makeUser({ hotel: makeHotel({ status: 'suspended' }) }),
      );
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.refresh('rt')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects an unverifiable token (401)', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('bad'));
      await expect(service.refresh('rt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout (8.5 AC3)', () => {
    it('clears the stored refresh hash', async () => {
      await service.logout('user-1');
      expect(usersRepo.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { refreshTokenHash: null },
      );
    });
  });

  describe('requestPasswordReset (8.4)', () => {
    const dto = { slug: 'sunrise', identifier: 'owner@sunrise.com' };

    it('AC1 — mints a token and emits the reset event for an active user', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);

      const res = await service.requestPasswordReset(dto);

      expect(user.resetTokenHash).toEqual(expect.any(String));
      expect(user.resetTokenExpiresAt).toBeInstanceOf(Date);
      expect(usersRepo.save).toHaveBeenCalledWith(user);
      expect(events.emitAsync).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.TENANT_PASSWORD_RESET_REQUESTED,
        expect.objectContaining({ tenantUserId: 'user-1', slug: 'sunrise' }),
      );
      expect(res).toHaveProperty('message');
    });

    it('AC1 — unknown email is accepted silently with no email', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      usersRepo.findOne.mockResolvedValue(null);
      await service.requestPasswordReset(dto);
      expect(events.emitAsync).not.toHaveBeenCalled();
      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it('AC4 — suspended hotel is accepted silently with no email', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel({ status: 'suspended' }));
      await service.requestPasswordReset(dto);
      expect(usersRepo.findOne).not.toHaveBeenCalled();
      expect(events.emitAsync).not.toHaveBeenCalled();
    });

    it('does not email a non-active (pending) user', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      usersRepo.findOne.mockResolvedValue(makeUser({ status: 'pending' }));
      await service.requestPasswordReset(dto);
      expect(events.emitAsync).not.toHaveBeenCalled();
    });

    it('AC5 — a username-shaped identifier never emails (accepted silently)', async () => {
      await service.requestPasswordReset({
        slug: 'sunrise',
        identifier: 'frontdesk1',
      });
      // Short-circuits before touching the hotel/user — no lookup, no email.
      expect(hotelsRepo.findOne).not.toHaveBeenCalled();
      expect(events.emitAsync).not.toHaveBeenCalled();
    });

    it('AC5 — a matched account without an email is accepted silently', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      usersRepo.findOne.mockResolvedValue(makeUser({ email: null }));
      await service.requestPasswordReset(dto);
      expect(events.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('confirmPasswordReset (8.4 AC3)', () => {
    it('sets the new password, clears the token, and invalidates sessions', async () => {
      const user = makeUser({
        resetTokenHash: 'stored',
        resetTokenExpiresAt: new Date(Date.now() + 3600_000),
        hotel: makeHotel(),
      });
      usersRepo.findOne.mockResolvedValue(user);

      await service.confirmPasswordReset({ token: 't', password: 'NewPass123' });

      expect(user.passwordHash).toBe('new-hash');
      expect(user.resetTokenHash).toBeNull();
      expect(user.resetTokenExpiresAt).toBeNull();
      expect(user.refreshTokenHash).toBeNull(); // all sessions killed
    });

    it('rejects an unknown/expired token with a generic 400', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.confirmPasswordReset({ token: 'x', password: 'NewPass123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an expired token', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          resetTokenHash: 'stored',
          resetTokenExpiresAt: new Date(Date.now() - 1000),
          hotel: makeHotel(),
        }),
      );
      await expect(
        service.confirmPasswordReset({ token: 'x', password: 'NewPass123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the hotel is suspended (403)', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          resetTokenHash: 'stored',
          resetTokenExpiresAt: new Date(Date.now() + 3600_000),
          hotel: makeHotel({ status: 'suspended' }),
        }),
      );
      await expect(
        service.confirmPasswordReset({ token: 'x', password: 'NewPass123' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a user disabled after requesting the reset (generic 400)', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          status: 'disabled',
          resetTokenHash: 'stored',
          resetTokenExpiresAt: new Date(Date.now() + 3600_000),
          hotel: makeHotel(),
        }),
      );
      await expect(
        service.confirmPasswordReset({ token: 'x', password: 'NewPass123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
