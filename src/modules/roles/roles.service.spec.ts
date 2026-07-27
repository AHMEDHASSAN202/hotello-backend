import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Admin } from '../admins/admin.entity';
import { Role } from './role.entity';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  let service: RolesService;
  let rolesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let adminsRepo: { count: jest.Mock };

  const makeRole = (overrides: Partial<Role> = {}): Role =>
    ({
      id: 'role-1',
      name: 'Support',
      description: null,
      permissions: ['admins.read'],
      isSystem: false,
      ...overrides,
    }) as Role;

  beforeEach(async () => {
    rolesRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (r) => r),
      remove: jest.fn(),
    };
    adminsRepo = { count: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(Role), useValue: rolesRepo },
        { provide: getRepositoryToken(Admin), useValue: adminsRepo },
      ],
    }).compile();

    service = moduleRef.get(RolesService);
  });

  describe('create (SA-ROLE-2)', () => {
    it('creates a role with catalog-valid permissions, isSystem=false', async () => {
      rolesRepo.findOne.mockResolvedValue(null);

      const created = await service.create({
        name: 'Support',
        description: 'Handles admins',
        permissions: ['admins.read', 'admins.update'],
      });

      expect(created.isSystem).toBe(false);
      expect(created.permissions).toEqual(['admins.read', 'admins.update']);
      expect(rolesRepo.save).toHaveBeenCalled();
    });

    it('returns 400 listing the unknown permission keys', async () => {
      await expect(
        service.create({
          name: 'Bad',
          permissions: ['admins.read', 'nope.read', 'foo.bar'],
        }),
      ).rejects.toThrow(
        new BadRequestException('Unknown permission keys: nope.read, foo.bar'),
      );
    });

    it('returns 409 on a duplicate name (case-insensitive)', async () => {
      rolesRepo.findOne.mockResolvedValue(makeRole());
      await expect(
        service.create({ name: 'support', permissions: [] }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows an empty permissions list (SA-ROLE-2.4)', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      const created = await service.create({ name: 'NoAccess', permissions: [] });
      expect(created.permissions).toEqual([]);
    });
  });

  describe('update (SA-ROLE-3)', () => {
    it('blocks modifying a system role with 400', async () => {
      rolesRepo.findOne.mockResolvedValue(makeRole({ isSystem: true }));
      await expect(
        service.update('role-1', { name: 'Hacked' }),
      ).rejects.toThrow(
        new BadRequestException('System roles cannot be modified'),
      );
    });

    it('updates name and permissions on success', async () => {
      rolesRepo.findOne
        .mockResolvedValueOnce(makeRole()) // findOne(id)
        .mockResolvedValueOnce(null); // name-availability check

      const updated = await service.update('role-1', {
        name: 'Support L2',
        permissions: ['admins.read', 'roles.read'],
      });

      expect(updated.name).toBe('Support L2');
      expect(updated.permissions).toEqual(['admins.read', 'roles.read']);
    });

    it('returns 404 for an unknown id', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove (SA-ROLE-4)', () => {
    it('blocks deleting a system role with 400', async () => {
      rolesRepo.findOne.mockResolvedValue(makeRole({ isSystem: true }));
      await expect(service.remove('role-1')).rejects.toThrow(
        new BadRequestException('System roles cannot be deleted'),
      );
    });

    it('returns 409 with the count when the role is still assigned', async () => {
      rolesRepo.findOne.mockResolvedValue(makeRole());
      adminsRepo.count.mockResolvedValue(3);
      await expect(service.remove('role-1')).rejects.toThrow(
        new ConflictException('Role is assigned to 3 admin(s)'),
      );
    });

    it('removes an unused, non-system role', async () => {
      const roleEntity = makeRole();
      rolesRepo.findOne.mockResolvedValue(roleEntity);
      adminsRepo.count.mockResolvedValue(0);
      await service.remove('role-1');
      expect(rolesRepo.remove).toHaveBeenCalledWith(roleEntity);
    });
  });
});
