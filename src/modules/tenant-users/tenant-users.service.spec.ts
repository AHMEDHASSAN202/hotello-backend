import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { Role } from '../roles/role.entity';
import { TenantUser } from './tenant-user.entity';
import { TenantUsersService } from './tenant-users.service';

jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

const HOUR_MS = 60 * 60 * 1000;
const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

describe('TenantUsersService', () => {
  let service: TenantUsersService;
  let tenantUsersRepo: { findOne: jest.Mock; save: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let auditLogs: { log: jest.Mock };

  const actor = {
    id: 'admin-1',
    role: { permissions: ['hotels.update'] } as Role,
  } as Admin;

  const makeOwner = (overrides: Partial<TenantUser> = {}): TenantUser =>
    ({
      id: 'owner-1',
      hotelId: 'hotel-1',
      name: 'Owner One',
      email: 'owner@nilegrand.example',
      role: 'owner',
      permissions: ['*'],
      status: 'pending',
      passwordHash: null,
      setupTokenHash: null,
      setupTokenExpiresAt: null,
      lastLoginAt: null,
      ...overrides,
    }) as TenantUser;

  beforeEach(async () => {
    tenantUsersRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (u) => u),
    };
    hotelsRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'hotel-1', slug: 'nile-grand' } as Hotel),
    };
    auditLogs = { log: jest.fn() };
    (mockedBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantUsersService,
        { provide: getRepositoryToken(TenantUser), useValue: tenantUsersRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => fallback),
          },
        },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = moduleRef.get(TenantUsersService);
    jest.clearAllMocks();
    (mockedBcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
  });

  describe('setup token lifecycle (SA-HTL-6)', () => {
    it('stores only the sha256 of the raw token with a 72h expiry', async () => {
      const owner = makeOwner();
      const before = Date.now();

      const { raw, expiresAt } = await service.issueSetupToken(owner);

      expect(owner.setupTokenHash).toBe(sha256(raw));
      expect(owner.setupTokenHash).not.toContain(raw);
      const expected = before + 72 * HOUR_MS;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expected);
      expect(expiresAt.getTime()).toBeLessThan(expected + 5000);
      expect(tenantUsersRepo.save).toHaveBeenCalledWith(owner);
    });

    it('saves through the provided EntityManager inside a transaction', async () => {
      const managerRepo = { save: jest.fn(async (u: TenantUser) => u) };
      const manager = { getRepository: jest.fn(() => managerRepo) };

      await service.issueSetupToken(makeOwner(), manager as never);

      expect(manager.getRepository).toHaveBeenCalledWith(TenantUser);
      expect(managerRepo.save).toHaveBeenCalled();
      expect(tenantUsersRepo.save).not.toHaveBeenCalled();
    });

    it('setup: hashes the password, activates the owner and clears the token (single-use)', async () => {
      const owner = makeOwner({
        setupTokenHash: sha256('valid-token'),
        setupTokenExpiresAt: new Date(Date.now() + HOUR_MS),
        hotel: { status: 'active' } as Hotel,
      });
      tenantUsersRepo.findOne.mockResolvedValue(owner);

      await service.setup({ token: 'valid-token', password: 'Secret123' });

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('Secret123', 10);
      expect(owner.passwordHash).toBe('hashed-password');
      expect(owner.status).toBe('active');
      expect(owner.setupTokenHash).toBeNull();
      expect(owner.setupTokenExpiresAt).toBeNull();
      // Lookup is by hash — the raw token itself never hits the query.
      expect(tenantUsersRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { setupTokenHash: sha256('valid-token') },
        }),
      );
    });

    it('rejects an unknown token with a generic 400', async () => {
      await expect(
        service.setup({ token: 'nope', password: 'Secret123' }),
      ).rejects.toThrow('Invalid or expired setup link');
    });

    it('rejects an expired token with the same message (no enumeration)', async () => {
      tenantUsersRepo.findOne.mockResolvedValue(
        makeOwner({
          setupTokenHash: sha256('old-token'),
          setupTokenExpiresAt: new Date(Date.now() - HOUR_MS),
        }),
      );
      await expect(
        service.setup({ token: 'old-token', password: 'Secret123' }),
      ).rejects.toThrow('Invalid or expired setup link');
    });

    it('rejects setup for a suspended hotel (SA-HTL-5 AC3)', async () => {
      tenantUsersRepo.findOne.mockResolvedValue(
        makeOwner({
          setupTokenHash: sha256('valid-token'),
          setupTokenExpiresAt: new Date(Date.now() + HOUR_MS),
          hotel: { status: 'suspended' } as Hotel,
        }),
      );
      await expect(
        service.setup({ token: 'valid-token', password: 'Secret123' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a used token cannot be replayed', async () => {
      const owner = makeOwner({
        setupTokenHash: sha256('valid-token'),
        setupTokenExpiresAt: new Date(Date.now() + HOUR_MS),
        hotel: { status: 'active' } as Hotel,
      });
      tenantUsersRepo.findOne.mockResolvedValue(owner);
      await service.setup({ token: 'valid-token', password: 'Secret123' });

      // The hash is now null — a second lookup by the same hash finds nothing.
      tenantUsersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.setup({ token: 'valid-token', password: 'Secret123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('regenerateSetupLink (SA-HTL-6 AC4)', () => {
    it('overwrites the stored hash (invalidating the old link) and audits', async () => {
      const owner = makeOwner({
        setupTokenHash: sha256('old-token'),
        setupTokenExpiresAt: new Date(Date.now() + HOUR_MS),
      });
      tenantUsersRepo.findOne.mockResolvedValue(owner);

      const result = await service.regenerateSetupLink('hotel-1', actor);

      expect(owner.setupTokenHash).not.toBe(sha256('old-token'));
      expect(result.setupLink).toMatch(
        /^https:\/\/nile-grand\.gxp\.example\/setup\?token=/,
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel.owner_link_regenerated',
          entityType: 'hotel',
          entityId: 'hotel-1',
          actorId: 'admin-1',
        }),
      );
    });

    it('returns 404 when the hotel has no owner account', async () => {
      tenantUsersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.regenerateSetupLink('hotel-1', actor),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for an unknown hotel', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.regenerateSetupLink('missing', actor),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
