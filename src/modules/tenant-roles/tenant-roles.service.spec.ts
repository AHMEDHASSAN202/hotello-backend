import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DEFAULT_TENANT_ROLES } from './default-tenant-roles';
import { TenantRole } from './tenant-role.entity';
import { TenantRolesService } from './tenant-roles.service';

describe('TenantRolesService', () => {
  let service: TenantRolesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => ({ id: 'role-new', ...row })),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRolesService,
        { provide: getRepositoryToken(TenantRole), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(TenantRolesService);
  });

  describe('seeded default roles (9.1)', () => {
    it('AC1 — seeds the four defaults with their exact permission sets', async () => {
      repo.findOne.mockResolvedValue(null); // none exist yet
      await service.seedDefaultRoles('hotel-1');

      expect(repo.save).toHaveBeenCalledTimes(DEFAULT_TENANT_ROLES.length);
      const saved = repo.save.mock.calls.map((c) => c[0]);

      const owner = saved.find((r) => r.nameEn === 'Owner');
      expect(owner).toMatchObject({
        hotelId: 'hotel-1',
        permissions: ['*'],
        isSystem: true,
      });
      const manager = saved.find((r) => r.nameEn === 'Manager');
      expect(manager.permissions).toEqual([
        'staff.read',
        'staff.invite',
        'staff.update',
        'staff.disable',
        'roles.read',
      ]);
      expect(manager.isSystem).toBe(false);
      expect(saved.map((r) => r.nameEn)).toEqual([
        'Owner',
        'Manager',
        'Front Desk',
        'Housekeeping',
      ]);
    });

    it('AC4 — every default carries an Arabic and English name', () => {
      for (const def of DEFAULT_TENANT_ROLES) {
        expect(def.nameEn.length).toBeGreaterThan(0);
        expect(def.nameAr.length).toBeGreaterThan(0);
        expect(def.descriptionEn.length).toBeGreaterThan(0);
        expect(def.descriptionAr.length).toBeGreaterThan(0);
      }
    });

    it('AC2 — is idempotent: a re-run creates nothing when roles already exist', async () => {
      repo.findOne.mockImplementation(async ({ where }) => ({
        id: 'existing',
        nameEn: where.nameEn,
      }));
      const result = await service.seedDefaultRoles('hotel-1');

      expect(repo.save).not.toHaveBeenCalled();
      expect(result).toHaveLength(DEFAULT_TENANT_ROLES.length);
    });

    it('uses the provided EntityManager when seeding inside a transaction', async () => {
      const managerRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((d) => d),
        save: jest.fn(async (r) => r),
      };
      const manager = { getRepository: jest.fn(() => managerRepo) };

      await service.seedDefaultRoles('hotel-1', manager as never);

      expect(manager.getRepository).toHaveBeenCalledWith(TenantRole);
      expect(managerRepo.save).toHaveBeenCalledTimes(DEFAULT_TENANT_ROLES.length);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findInHotel', () => {
    it('returns a role scoped to the hotel', async () => {
      repo.findOne.mockResolvedValue({ id: 'role-1', hotelId: 'hotel-1' });
      await expect(service.findInHotel('hotel-1', 'role-1')).resolves.toMatchObject(
        { id: 'role-1' },
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'role-1', hotelId: 'hotel-1' },
      });
    });

    it('404s an unknown or cross-tenant role (no existence leak)', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findInHotel('hotel-1', 'other')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('assertNotSystemMutation (9.1 AC3)', () => {
    it('rejects mutating a system role', () => {
      expect(() =>
        service.assertNotSystemMutation({ isSystem: true } as TenantRole),
      ).toThrow(BadRequestException);
    });

    it('allows mutating a non-system role', () => {
      expect(() =>
        service.assertNotSystemMutation({ isSystem: false } as TenantRole),
      ).not.toThrow();
    });
  });
});
