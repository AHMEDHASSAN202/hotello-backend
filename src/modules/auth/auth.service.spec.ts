import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Admin } from '../admins/admin.entity';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-value'),
  compare: jest.fn(),
}));

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };

  const makeAdmin = (overrides: Partial<Admin> = {}): Admin =>
    ({
      id: 'admin-1',
      name: 'Ahmed',
      email: 'ahmed@gxp.app',
      passwordHash: 'stored-hash',
      refreshTokenHash: 'stored-refresh-hash',
      isActive: true,
      preferredLanguage: 'en',
      lastLoginAt: null,
      roleId: 'role-1',
      role: { id: 'role-1', name: 'Super Admin', permissions: ['*'] },
      ...overrides,
    }) as Admin;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn(async (a) => a),
      update: jest.fn(),
    };
    jwt = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token'),
      verifyAsync: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(Admin), useValue: repo },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, def?: string) => def ?? 'secret') },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jest.clearAllMocks();
    jwt.signAsync
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');
  });

  describe('login (SA-AUTH-1)', () => {
    it('returns tokens + admin summary and updates lastLoginAt on success', async () => {
      const admin = makeAdmin();
      repo.findOne.mockResolvedValue(admin);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.login({
        email: 'Ahmed@GXP.app',
        password: 'Secret123',
      });

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { email: 'ahmed@gxp.app' },
      });
      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.admin).toEqual({
        id: 'admin-1',
        name: 'Ahmed',
        email: 'ahmed@gxp.app',
        preferredLanguage: 'en',
        role: { id: 'role-1', name: 'Super Admin', permissions: ['*'] },
      });
      expect(admin.lastLoginAt).toBeInstanceOf(Date);
      // Refresh token stored only as a hash.
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('new-refresh-token', 10);
      expect(repo.save).toHaveBeenCalled();
      expect((result as Record<string, unknown>)['passwordHash']).toBeUndefined();
    });

    it('returns 401 for an unknown email', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nobody@x.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns the same 401 for a wrong password (no enumeration)', async () => {
      repo.findOne.mockResolvedValue(makeAdmin());
      mockedBcrypt.compare.mockResolvedValue(false as never);
      await expect(
        service.login({ email: 'ahmed@gxp.app', password: 'wrong' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });

    it('returns 403 for a deactivated admin with correct credentials', async () => {
      repo.findOne.mockResolvedValue(makeAdmin({ isActive: false }));
      mockedBcrypt.compare.mockResolvedValue(true as never);
      await expect(
        service.login({ email: 'ahmed@gxp.app', password: 'Secret123' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('refresh (SA-AUTH-2)', () => {
    it('rotates the pair and stores the new hash on success', async () => {
      const admin = makeAdmin();
      jwt.verifyAsync.mockResolvedValue({ sub: 'admin-1' });
      repo.findOne.mockResolvedValue(admin);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.refresh('valid-refresh-token');

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('new-refresh-token', 10);
      expect(repo.save).toHaveBeenCalledWith(admin);
    });

    it('returns 401 for a forged/invalid token', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('bad signature'));
      await expect(service.refresh('forged')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns 401 for a rotated-out (old) token', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'admin-1' });
      repo.findOne.mockResolvedValue(makeAdmin());
      mockedBcrypt.compare.mockResolvedValue(false as never);
      await expect(service.refresh('old-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns 401 when there is no active session (hash cleared)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'admin-1' });
      repo.findOne.mockResolvedValue(makeAdmin({ refreshTokenHash: null }));
      await expect(service.refresh('any-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns 403 for a deactivated admin (SA-AUTH-2.3)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'admin-1' });
      repo.findOne.mockResolvedValue(makeAdmin({ isActive: false }));
      mockedBcrypt.compare.mockResolvedValue(true as never);
      await expect(service.refresh('valid-token')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('logout (SA-AUTH-3)', () => {
    it('clears the stored refresh-token hash', async () => {
      await service.logout('admin-1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'admin-1' },
        { refreshTokenHash: null },
      );
    });
  });

  describe('updateProfile', () => {
    it('updates name and lowercases a new email', async () => {
      const admin = makeAdmin();
      repo.findOne.mockResolvedValue(null); // email availability lookup

      const updated = await service.updateProfile(admin, {
        name: 'Renamed',
        email: 'New.Email@GXP.APP',
      });

      expect(updated.name).toBe('Renamed');
      expect(updated.email).toBe('new.email@gxp.app');
      expect(repo.save).toHaveBeenCalledWith(admin);
    });

    it('returns 409 when the new email belongs to another account', async () => {
      const admin = makeAdmin();
      repo.findOne.mockResolvedValue(makeAdmin({ id: 'other-admin' }));

      await expect(
        service.updateProfile(admin, { email: 'taken@gxp.app' }),
      ).rejects.toThrow(ConflictException);
    });

    it('keeping the same email does not trigger a conflict check', async () => {
      const admin = makeAdmin();

      const updated = await service.updateProfile(admin, {
        email: 'Ahmed@GXP.app', // same address, different casing
      });

      expect(repo.findOne).not.toHaveBeenCalled();
      expect(updated.email).toBe('ahmed@gxp.app');
    });

    it('updates the preferred UI language (Epic 07 — language persistence)', async () => {
      const admin = makeAdmin();

      const updated = await service.updateProfile(admin, {
        preferredLanguage: 'ar',
      });

      expect(repo.findOne).not.toHaveBeenCalled(); // no email lookup
      expect(updated.preferredLanguage).toBe('ar');
      expect(repo.save).toHaveBeenCalledWith(admin);
    });
  });

  describe('changePassword (SA-AUTH-5)', () => {
    it('returns 400 when the current password is wrong', async () => {
      mockedBcrypt.compare.mockResolvedValue(false as never);
      await expect(
        service.changePassword(makeAdmin(), {
          currentPassword: 'wrong',
          newPassword: 'NewSecret1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rehashes the password and kills all sessions on success', async () => {
      const admin = makeAdmin();
      mockedBcrypt.compare.mockResolvedValue(true as never);

      await service.changePassword(admin, {
        currentPassword: 'Secret123',
        newPassword: 'NewSecret1',
      });

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('NewSecret1', 10);
      expect(admin.passwordHash).toBe('hashed-value');
      expect(admin.refreshTokenHash).toBeNull();
      expect(repo.save).toHaveBeenCalledWith(admin);
    });
  });
});
