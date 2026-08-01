import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantRole } from '../tenant-roles/tenant-role.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantProfileService } from './tenant-profile.service';

jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('TenantProfileService (8.7)', () => {
  let service: TenantProfileService;
  let repo: { save: jest.Mock };
  let rolesRepo: { count: jest.Mock };
  let access: { getAccessState: jest.Mock };
  let audit: { log: jest.Mock };

  const user = (o: Partial<TenantUser> = {}): TenantUser =>
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
      preferredLanguage: null,
      passwordHash: 'stored',
      refreshTokenHash: 'rt',
      dismissedHints: [],
      hotel: { slug: 'sunrise', nameEn: 'Sunrise', nameAr: 'شروق', logoPath: null, defaultLanguage: 'ar', staffUsersCount: 1 },
      ...o,
    }) as TenantUser;

  beforeEach(async () => {
    repo = { save: jest.fn(async (u) => u) };
    rolesRepo = { count: jest.fn().mockResolvedValue(0) };
    access = {
      getAccessState: jest.fn().mockResolvedValue({
        hotelStatus: 'active',
        subscriptionStatus: 'trial',
        trialEndsAt: null,
        trialDaysRemaining: 5,
        readOnly: false,
        enabledModules: [],
        planNameEn: 'Pro',
        planNameAr: 'برو',
      }),
    };
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantProfileService,
        { provide: getRepositoryToken(TenantUser), useValue: repo },
        { provide: getRepositoryToken(TenantRole), useValue: rolesRepo },
        { provide: TenantAccessService, useValue: access },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(TenantProfileService);
    mockedBcrypt.compare.mockReset();
    (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
  });

  it('me() composes user + hotel + live subscription state', async () => {
    const result = await service.me(user());
    expect(result.user).toMatchObject({
      id: 'user-1',
      role: { nameEn: 'Owner', isSystem: true },
      permissions: ['*'],
    });
    expect(result.hotel).toMatchObject({ slug: 'sunrise' });
    expect(result.subscription).toMatchObject({ trialDaysRemaining: 5 });
  });

  it('updates name and preferredLanguage', async () => {
    const u = user();
    await service.updateProfile(u, { name: 'New Name', preferredLanguage: 'en' });
    expect(u.name).toBe('New Name');
    expect(u.preferredLanguage).toBe('en');
    expect(repo.save).toHaveBeenCalledWith(u);
  });

  it('change-password: rejects a wrong current password', async () => {
    (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
    await expect(
      service.changePassword(user(), { currentPassword: 'bad', newPassword: 'NewPass123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('change-password: sets the hash and kills other sessions', async () => {
    (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
    const u = user();
    await service.changePassword(u, { currentPassword: 'ok', newPassword: 'NewPass123' });
    expect(u.passwordHash).toBe('new-hash');
    expect(u.refreshTokenHash).toBeNull();
    expect(audit.log).toHaveBeenCalled();
  });

  describe('hint dismissal (12.4)', () => {
    it('AC2 — persists a dismissed hint key on the user', async () => {
      const u = user();
      await service.dismissHint(u, 'staff.firstRun');
      expect(u.dismissedHints).toEqual(['staff.firstRun']);
      expect(repo.save).toHaveBeenCalledWith(u);
    });

    it('AC2 — dismissal is idempotent (no duplicate keys, no extra save)', async () => {
      const u = user({ dismissedHints: ['staff.firstRun'] });
      await service.dismissHint(u, 'staff.firstRun');
      expect(u.dismissedHints).toEqual(['staff.firstRun']);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects a key outside the code-side allowlist', async () => {
      await expect(service.dismissHint(user(), 'not.a.hint')).rejects.toMatchObject({
        response: { code: 'INVALID_HINT_KEY' },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('AC2 — me() exposes dismissedHints for the HintCard render check', async () => {
      const result = await service.me(user({ dismissedHints: ['roles.firstRun'] }));
      expect(result.user.dismissedHints).toEqual(['roles.firstRun']);
    });
  });

  describe('setup status (12.4 AC3)', () => {
    it('fresh hotel (owner only, no custom roles) → nothing complete', async () => {
      const result = await service.me(user());
      expect(result.setup).toEqual({ staffAdded: false, roleCreated: false, complete: false });
    });

    it('staffAdded flips when the hotel has staff beyond the owner', async () => {
      const result = await service.me(
        user({ hotel: { slug: 'sunrise', staffUsersCount: 3 } as never }),
      );
      expect(result.setup.staffAdded).toBe(true);
    });

    it('roleCreated derives from custom (non-system) roles, scoped to the hotel', async () => {
      rolesRepo.count.mockResolvedValue(2);
      const result = await service.me(user());
      expect(rolesRepo.count).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1', isSystem: false },
      });
      expect(result.setup.roleCreated).toBe(true);
    });

    it('complete only when every derivable step is done', async () => {
      rolesRepo.count.mockResolvedValue(1);
      const result = await service.me(
        user({ hotel: { slug: 'sunrise', staffUsersCount: 2 } as never }),
      );
      expect(result.setup).toEqual({ staffAdded: true, roleCreated: true, complete: true });
    });
  });
});
