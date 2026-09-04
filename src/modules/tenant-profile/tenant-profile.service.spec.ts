import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantRole } from '../tenant-roles/tenant-role.entity';
import { Room } from '../tenant-rooms/room.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantProfileService } from './tenant-profile.service';

jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('TenantProfileService (8.7)', () => {
  let service: TenantProfileService;
  let repo: { save: jest.Mock };
  let rolesRepo: { count: jest.Mock };
  let roomsRepo: { count: jest.Mock };
  let access: { getAccessState: jest.Mock };
  let audit: { log: jest.Mock };
  let config: { get: jest.Mock };

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
      hotel: {
        slug: 'sunrise',
        nameEn: 'Sunrise',
        nameAr: 'شروق',
        logoPath: null,
        defaultLanguage: 'ar',
        staffUsersCount: 1,
        qrGeneratedAt: null,
      },
      ...o,
    }) as TenantUser;

  beforeEach(async () => {
    repo = { save: jest.fn(async (u) => u) };
    rolesRepo = { count: jest.fn().mockResolvedValue(0) };
    roomsRepo = { count: jest.fn().mockResolvedValue(0) };
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
    config = {
      // Mirrors PushService's own defaults (23.3) — same env keys, same fallback.
      get: jest.fn((key: string, def?: string) => def),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantProfileService,
        { provide: getRepositoryToken(TenantUser), useValue: repo },
        { provide: getRepositoryToken(TenantRole), useValue: rolesRepo },
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: TenantAccessService, useValue: access },
        { provide: AuditLogsService, useValue: audit },
        { provide: ConfigService, useValue: config },
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

  it('23.3 — me() exposes hotel.pushQuietHours from env (defaults 22:00/08:00)', async () => {
    const result = await service.me(user());
    expect(result.hotel.pushQuietHours).toEqual({ start: '22:00', end: '08:00' });
  });

  it('23.3 — me() reflects a custom configured quiet window', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'PUSH_QUIET_START' ? '23:00' : key === 'PUSH_QUIET_END' ? '07:00' : undefined,
    );
    const result = await service.me(user());
    expect(result.hotel.pushQuietHours).toEqual({ start: '23:00', end: '07:00' });
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

  it('change-password: clears mustChangePassword (9.7 AC4 — the forced screen must not repeat)', async () => {
    (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
    const u = user({ mustChangePassword: true });
    await service.changePassword(u, {
      currentPassword: 'temp',
      newPassword: 'NewPass123',
    });
    expect(u.mustChangePassword).toBe(false);
    expect((await service.me(u)).user.mustChangePassword).toBe(false);
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

    it('Epic 15 — undismissHint removes a stored key (sound toggle un-mute)', async () => {
      const u = user({
        dismissedHints: ['staff.firstRun', 'requests.soundMuted'],
      });
      await service.undismissHint(u, 'requests.soundMuted');
      expect(u.dismissedHints).toEqual(['staff.firstRun']);
      expect(repo.save).toHaveBeenCalledWith(u);
    });

    it('Epic 15 — undismissHint is idempotent when the key is absent', async () => {
      const u = user({ dismissedHints: [] });
      await service.undismissHint(u, 'requests.soundMuted');
      expect(u.dismissedHints).toEqual([]);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('Epic 15 — undismissHint rejects keys outside the allowlist', async () => {
      await expect(
        service.undismissHint(user(), 'not.a.hint'),
      ).rejects.toMatchObject({ response: { code: 'INVALID_HINT_KEY' } });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('setup status (12.4 AC3 / 11.6)', () => {
    it('fresh hotel (owner only, no custom roles, no rooms, no QR) → nothing complete', async () => {
      const result = await service.me(user());
      expect(result.setup).toEqual({
        staffAdded: false,
        roleCreated: false,
        roomsAdded: false,
        qrGenerated: false,
        complete: false,
      });
    });

    it('staffAdded flips when the hotel has staff beyond the owner', async () => {
      const result = await service.me(
        user({ hotel: { slug: 'sunrise', staffUsersCount: 3 } as never }),
      );
      expect(result.setup.staffAdded).toBe(true);
    });

    it('Epic 16 — exposes the hotel currency for price formatting', async () => {
      const result = await service.me(
        user({ hotel: { slug: 'sunrise', currency: 'USD' } as never }),
      );
      expect(result.hotel.currency).toEqual('USD');
    });

    it('roleCreated derives from custom (non-system) roles, scoped to the hotel', async () => {
      rolesRepo.count.mockResolvedValue(2);
      const result = await service.me(user());
      expect(rolesRepo.count).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1', isSystem: false },
      });
      expect(result.setup.roleCreated).toBe(true);
    });

    describe('AC4 — roomsAdded', () => {
      it('false with zero rooms', async () => {
        roomsRepo.count.mockResolvedValue(0);
        const result = await service.me(user());
        expect(roomsRepo.count).toHaveBeenCalledWith({
          where: { hotelId: 'hotel-1' },
        });
        expect(result.setup.roomsAdded).toBe(false);
      });

      it('true once a room exists, counting ANY room row regardless of status', async () => {
        roomsRepo.count.mockResolvedValue(1);
        const result = await service.me(user());
        expect(result.setup.roomsAdded).toBe(true);
      });
    });

    describe('qrGenerated', () => {
      it('reflects hotels.qrGeneratedAt — false while null', async () => {
        const result = await service.me(
          user({ hotel: { slug: 'sunrise', staffUsersCount: 1, qrGeneratedAt: null } as never }),
        );
        expect(result.setup.qrGenerated).toBe(false);
      });

      it('reflects hotels.qrGeneratedAt — true once set', async () => {
        const result = await service.me(
          user({
            hotel: {
              slug: 'sunrise',
              staffUsersCount: 1,
              qrGeneratedAt: new Date('2026-08-01'),
            } as never,
          }),
        );
        expect(result.setup.qrGenerated).toBe(true);
      });
    });

    it('complete only when every derivable step is done', async () => {
      rolesRepo.count.mockResolvedValue(1);
      roomsRepo.count.mockResolvedValue(2);
      const result = await service.me(
        user({
          hotel: {
            slug: 'sunrise',
            staffUsersCount: 2,
            qrGeneratedAt: new Date('2026-08-01'),
          } as never,
        }),
      );
      expect(result.setup).toEqual({
        staffAdded: true,
        roleCreated: true,
        roomsAdded: true,
        qrGenerated: true,
        complete: true,
      });
    });

    it('not complete when rooms/QR steps are still pending, even with staff + roles done', async () => {
      rolesRepo.count.mockResolvedValue(1);
      roomsRepo.count.mockResolvedValue(0);
      const result = await service.me(
        user({ hotel: { slug: 'sunrise', staffUsersCount: 2, qrGeneratedAt: null } as never }),
      );
      expect(result.setup.complete).toBe(false);
    });
  });
});
