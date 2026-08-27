import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { DEFAULT_TENANT_ROLES } from './default-tenant-roles';
import { TenantRole } from './tenant-role.entity';
import { TenantRolesService } from './tenant-roles.service';

/** Owner-equivalent actor holding the wildcard. */
const owner = { id: 'owner-1', hotelId: 'hotel-1', role: { permissions: ['*'] } } as TenantUser;
/** Partial-permission actor (a Manager with roles.create but limited scope). */
const manager = {
  id: 'mgr-1',
  hotelId: 'hotel-1',
  role: { permissions: ['roles.read', 'roles.create', 'staff.read'] },
} as TenantUser;

describe('TenantRolesService', () => {
  let service: TenantRolesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let usersRepo: { count: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let access: { getAccessState: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => ({ id: 'role-new', ...row })),
      remove: jest.fn(async () => undefined),
    };
    usersRepo = { count: jest.fn().mockResolvedValue(0) };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    access = {
      getAccessState: jest.fn().mockResolvedValue({ enabledModules: [] }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRolesService,
        { provide: getRepositoryToken(TenantRole), useValue: repo },
        { provide: getRepositoryToken(TenantUser), useValue: usersRepo },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: TenantAccessService, useValue: access },
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

      const ownerRole = saved.find((r) => r.nameEn === 'Owner');
      expect(ownerRole).toMatchObject({
        hotelId: 'hotel-1',
        permissions: ['*'],
        isSystem: true,
      });
      const managerRole = saved.find((r) => r.nameEn === 'Manager');
      expect(managerRole.permissions).toEqual([
        'staff.read',
        'staff.invite',
        'staff.update',
        'staff.disable',
        'roles.read',
        'rooms.read',
        'rooms.create',
        'rooms.update',
        'stays.read',
        'stays.checkin',
        'stays.update',
        'stays.checkout',
        'requests.read',
        'requests.update',
        'requests.assign',
        'request_catalog.manage',
        'fnb_menus.manage',
        'fnb_locations.manage',
        'fnb_orders.read',
        'fnb_orders.update',
        'fnb_settings.manage',
        'hotel_info.manage',
        'branding.manage',
      ]);
      const frontDeskRole = saved.find((r) => r.nameEn === 'Front Desk');
      expect(frontDeskRole.permissions).toEqual(
        expect.arrayContaining([
          'requests.read',
          'requests.update',
          'requests.assign',
        ]),
      );
      expect(frontDeskRole.permissions).not.toContain(
        'request_catalog.manage',
      );
      const housekeepingRole = saved.find((r) => r.nameEn === 'Housekeeping');
      expect(housekeepingRole.permissions).toEqual(
        expect.arrayContaining(['requests.read', 'requests.update']),
      );
      expect(housekeepingRole.permissions).not.toContain('requests.assign');
      expect(managerRole.isSystem).toBe(false);
      // Epic 16 — the F&B / Kitchen persona joins the defaults.
      const kitchenRole = saved.find((r) => r.nameEn === 'F&B / Kitchen');
      expect(kitchenRole.permissions).toEqual([
        'fnb_orders.read',
        'fnb_orders.update',
        'fnb_menus.manage',
      ]);
      expect(saved.map((r) => r.nameEn)).toEqual([
        'Owner',
        'Manager',
        'Front Desk',
        'Housekeeping',
        'F&B / Kitchen',
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
      const em = { getRepository: jest.fn(() => managerRepo) };

      await service.seedDefaultRoles('hotel-1', em as never);

      expect(em.getRepository).toHaveBeenCalledWith(TenantRole);
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

  describe('assertNotSystemMutation (9.1 AC3 / 10.3 AC1)', () => {
    it('rejects mutating a system role with 403', () => {
      expect(() =>
        service.assertNotSystemMutation({ isSystem: true } as TenantRole),
      ).toThrow(ForbiddenException);
    });

    it('allows mutating a non-system role', () => {
      expect(() =>
        service.assertNotSystemMutation({ isSystem: false } as TenantRole),
      ).not.toThrow();
    });
  });

  describe('getManagementList (10.1 AC2)', () => {
    it('attaches an assigned-staff count to each role', async () => {
      repo.find.mockResolvedValue([
        { id: 'r1', hotelId: 'hotel-1' },
        { id: 'r2', hotelId: 'hotel-1' },
      ]);
      usersRepo.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

      const list = await service.getManagementList('hotel-1');

      expect(list).toEqual([
        expect.objectContaining({ id: 'r1', staffCount: 3 }),
        expect.objectContaining({ id: 'r2', staffCount: 0 }),
      ]);
    });
  });

  describe('getCatalog (10.5 AC3 — module gating)', () => {
    it('always includes core (ungated) groups', async () => {
      access.getAccessState.mockResolvedValue({ enabledModules: [] });
      const catalog = await service.getCatalog('hotel-1');
      expect(catalog.map((g) => g.group)).toEqual(
        expect.arrayContaining(['staff', 'roles']),
      );
    });

    it('Epic 15 note 7 — hides the requests group when the module is not in the plan', async () => {
      access.getAccessState.mockResolvedValue({ enabledModules: ['fnb'] });
      const catalog = await service.getCatalog('hotel-1');
      expect(catalog.map((g) => g.group)).not.toContain('requests');
    });

    it('Epic 15 note 7 — shows the requests group when the module is enabled', async () => {
      access.getAccessState.mockResolvedValue({
        enabledModules: ['requests'],
      });
      const catalog = await service.getCatalog('hotel-1');
      expect(catalog.map((g) => g.group)).toContain('requests');
    });
  });

  describe('createRole (10.2)', () => {
    const base = { nameEn: 'Concierge', nameAr: 'كونسيرج', permissions: ['staff.read'] };

    it('AC2 — rejects unknown permission keys with 422', async () => {
      await expect(
        service.createRole(owner, { ...base, permissions: ['staff.read', 'bogus.key'] }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('AC2 — refuses the wildcard on a custom role (422)', async () => {
      await expect(
        service.createRole(owner, { ...base, permissions: ['*'] }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('AC2 — rejects a duplicate name per language (case-insensitive) with 409', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'existing' }); // nameEn clash
      await expect(service.createRole(owner, base)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('AC3 — blocks escalation: cannot grant a permission you do not hold', async () => {
      // manager holds staff.read but not staff.invite
      await expect(
        service.createRole(manager, { ...base, permissions: ['staff.invite'] }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'PERMISSION_ESCALATION',
          permissions: ['staff.invite'],
        }),
      });
    });

    it('AC3 — an Owner (*) holder can grant any catalog permission', async () => {
      await expect(
        service.createRole(owner, { ...base, permissions: ['staff.invite'] }),
      ).resolves.toMatchObject({ isSystem: false });
    });

    it('AC1/AC4 — creates a non-system role and audits role.created', async () => {
      const role = await service.createRole(manager, base);
      expect(role).toMatchObject({ hotelId: 'hotel-1', isSystem: false });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'role.created', actorId: 'mgr-1' }),
      );
    });
  });

  describe('updateRole (10.3)', () => {
    it('AC1 — system roles are not editable (403)', async () => {
      repo.findOne.mockResolvedValue({ id: 'owner-role', hotelId: 'hotel-1', isSystem: true });
      await expect(
        service.updateRole(owner, 'owner-role', { nameEn: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('AC1 — enforces the escalation guard on updated permissions', async () => {
      repo.findOne.mockResolvedValue({
        id: 'r1',
        hotelId: 'hotel-1',
        isSystem: false,
        permissions: [],
      });
      await expect(
        service.updateRole(manager, 'r1', { permissions: ['staff.disable'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('AC4 — saves and audits role.updated with a before/after diff', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'r1',
          hotelId: 'hotel-1',
          isSystem: false,
          nameEn: 'Old',
          nameAr: 'قديم',
          descriptionEn: null,
          descriptionAr: null,
          permissions: ['staff.read'],
        })
        .mockResolvedValue(null); // name-availability checks
      await service.updateRole(owner, 'r1', { permissions: ['staff.read', 'staff.invite'] });

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.updated',
          metadata: expect.objectContaining({
            before: expect.objectContaining({ permissions: ['staff.read'] }),
            after: expect.objectContaining({ permissions: ['staff.read', 'staff.invite'] }),
          }),
        }),
      );
    });
  });

  describe('deleteRole (10.4)', () => {
    it('AC1 — refuses to delete a role with assigned staff (409 + count)', async () => {
      repo.findOne.mockResolvedValue({ id: 'r1', hotelId: 'hotel-1', isSystem: false });
      usersRepo.count.mockResolvedValue(2);
      await expect(service.deleteRole(owner, 'r1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ROLE_IN_USE', staffCount: 2 }),
      });
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('AC1 — system roles cannot be deleted (403)', async () => {
      repo.findOne.mockResolvedValue({ id: 'owner-role', hotelId: 'hotel-1', isSystem: true });
      await expect(service.deleteRole(owner, 'owner-role')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('AC2/AC3 — hard-deletes an unassigned non-system role and audits role.deleted', async () => {
      repo.findOne.mockResolvedValue({
        id: 'r1',
        hotelId: 'hotel-1',
        isSystem: false,
        nameEn: 'Front Desk',
        nameAr: 'الاستقبال',
        permissions: [],
      });
      usersRepo.count.mockResolvedValue(0);

      await service.deleteRole(owner, 'r1');

      expect(repo.remove).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.deleted',
          metadata: expect.objectContaining({ nameEn: 'Front Desk' }),
        }),
      );
    });
  });
});
