import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Role } from '../roles/role.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { OnboardHotelDto } from './dto/onboard-hotel.dto';
import { HotelOnboardingService } from './hotel-onboarding.service';
import { HotelsService } from './hotels.service';

describe('HotelOnboardingService', () => {
  let service: HotelOnboardingService;
  let hotelsService: { assertSlugUsable: jest.Mock; toDetail: jest.Mock };
  let subscriptionsService: { createInitialSubscription: jest.Mock };
  let tenantUsersService: {
    issueSetupToken: jest.Mock;
    buildSetupLink: jest.Mock;
  };
  let tenantUsersRepo: { findOne: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let managerRepos: Map<unknown, { create: jest.Mock; save: jest.Mock }>;
  let dataSource: { transaction: jest.Mock };

  const actor = {
    id: 'admin-1',
    role: { permissions: ['*'] } as Role,
  } as Admin;

  const makeDto = (overrides: Partial<OnboardHotelDto> = {}): OnboardHotelDto =>
    ({
      profile: {
        nameEn: 'Nile Grand',
        nameAr: 'نايل جراند',
        slug: 'nile-grand',
        contactEmail: 'Info@NileGrand.example',
        contactPhone: '+20 100 000 0000',
        city: 'Cairo',
        roomsCount: 80,
      },
      plan: { planId: 'plan-trial' },
      owner: { name: 'Owner One', email: 'Owner@NileGrand.example' },
      ...overrides,
    }) as OnboardHotelDto;

  beforeEach(async () => {
    managerRepos = new Map();
    const manager = {
      getRepository: jest.fn((entity) => {
        if (!managerRepos.has(entity)) {
          managerRepos.set(entity, {
            create: jest.fn((data) => data),
            save: jest.fn(async (row) => ({
              id: `${(entity as { name?: string }).name ?? 'row'}-1`,
              ...row,
            })),
          });
        }
        return managerRepos.get(entity);
      }),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };

    hotelsService = {
      assertSlugUsable: jest.fn().mockResolvedValue(undefined),
      toDetail: jest.fn((hotel, owner) => ({ ...hotel, owner })),
    };
    subscriptionsService = {
      createInitialSubscription: jest.fn().mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-trial',
        billingCycle: 'monthly',
        status: 'trial',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      }),
    };
    tenantUsersService = {
      issueSetupToken: jest.fn().mockResolvedValue({
        raw: 'raw-token',
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
      buildSetupLink: jest.fn(
        (slug: string, raw: string) =>
          `https://${slug}.gxp.example/setup?token=${raw}`,
      ),
    };
    tenantUsersRepo = { findOne: jest.fn().mockResolvedValue(null) };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HotelOnboardingService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(TenantUser), useValue: tenantUsersRepo },
        { provide: HotelsService, useValue: hotelsService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: TenantUsersService, useValue: tenantUsersService },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = moduleRef.get(HotelOnboardingService);
  });

  describe('onboard (SA-HTL-3)', () => {
    it('creates hotel + subscription + pending owner in one transaction and returns the setup link once', async () => {
      const result = await service.onboard(makeDto(), actor);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      // Subscription created through the transaction's EntityManager.
      expect(
        subscriptionsService.createInitialSubscription,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ slug: 'nile-grand' }),
        { planId: 'plan-trial' },
        actor,
      );
      // Owner is a pending tenant-scoped super admin with the wildcard.
      expect(tenantUsersService.issueSetupToken).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'owner',
          permissions: ['*'],
          status: 'pending',
          email: 'owner@nilegrand.example', // lowercased
        }),
        expect.anything(),
      );
      expect(result.owner.setupLink).toBe(
        'https://nile-grand.gxp.example/setup?token=raw-token',
      );
      expect(result.subscription.status).toBe('trial');
      expect(result.subscription.daysRemaining).toBe(14);
      // Audit written after the transaction committed.
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel.created',
          actorId: 'admin-1',
          metadata: expect.objectContaining({
            slug: 'nile-grand',
            ownerEmail: 'owner@nilegrand.example',
          }),
        }),
      );
    });

    it('applies profile defaults through the entity (only provided fields set)', async () => {
      await service.onboard(makeDto(), actor);
      const hotelRepo = [...managerRepos.values()][0];
      const created = hotelRepo.create.mock.calls[0][0];
      expect(created).not.toHaveProperty('country');
      expect(created).not.toHaveProperty('timezone');
      expect(created.contactEmail).toBe('info@nilegrand.example');
      expect(created.onboardedById).toBe('admin-1');
    });

    it('rejects a taken slug before opening the transaction', async () => {
      hotelsService.assertSlugUsable.mockRejectedValue(
        new ConflictException('Slug is already taken'),
      );
      await expect(service.onboard(makeDto(), actor)).rejects.toThrow(
        ConflictException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('atomicity (SA-HTL-3 AC6)', () => {
    it('propagates a failure inside the transaction and writes no audit entry', async () => {
      subscriptionsService.createInitialSubscription.mockRejectedValue(
        new ConflictException('Archived plans cannot be selected'),
      );

      await expect(service.onboard(makeDto(), actor)).rejects.toThrow(
        ConflictException,
      );
      // The rollback happens in dataSource.transaction; what the service must
      // guarantee is that no post-commit side effects ran.
      expect(auditLogs.log).not.toHaveBeenCalled();
      expect(tenantUsersService.issueSetupToken).not.toHaveBeenCalled();
    });
  });

  describe('owner email conflict (SA-HTL-6 AC2)', () => {
    it('returns 422 with the offending field for a duplicate owner email', async () => {
      tenantUsersRepo.findOne.mockResolvedValue({ id: 'existing' });

      await expect(service.onboard(makeDto(), actor)).rejects.toMatchObject({
        constructor: UnprocessableEntityException,
        response: expect.objectContaining({ field: 'owner.email' }),
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
