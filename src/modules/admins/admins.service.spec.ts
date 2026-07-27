import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../roles/role.entity';
import { Admin } from './admin.entity';
import { AdminsService } from './admins.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AdminsService', () => {
  let service: AdminsService;
  let adminsRepo: {
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let rolesRepo: { findOne: jest.Mock };

  const role = { id: 'role-1', name: 'Support', permissions: [] } as unknown as Role;

  const makeAdmin = (overrides: Partial<Admin> = {}): Admin =>
    ({
      id: 'admin-1',
      name: 'Ahmed',
      email: 'ahmed@hotello.app',
      passwordHash: 'old-hash',
      refreshTokenHash: 'refresh-hash',
      isActive: true,
      roleId: 'role-1',
      role,
      ...overrides,
    }) as Admin;

  beforeEach(async () => {
    adminsRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (a) => a),
      remove: jest.fn(),
    };
    rolesRepo = { findOne: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminsService,
        { provide: getRepositoryToken(Admin), useValue: adminsRepo },
        { provide: getRepositoryToken(Role), useValue: rolesRepo },
      ],
    }).compile();

    service = moduleRef.get(AdminsService);
    jest.clearAllMocks();
  });

  describe('create (SA-ADM-2)', () => {
    const dto = {
      name: 'New Admin',
      email: 'New.Admin@Hotello.APP',
      password: 'Secret123',
      roleId: 'role-1',
    };

    it('hashes the password, lowercases the email and defaults to active', async () => {
      adminsRepo.findOne.mockResolvedValue(null);
      rolesRepo.findOne.mockResolvedValue(role);

      const created = await service.create(dto);

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('Secret123', 10);
      expect(created.email).toBe('new.admin@hotello.app');
      expect(created.passwordHash).toBe('hashed-password');
      expect(created.isActive).toBe(true);
      expect(adminsRepo.save).toHaveBeenCalled();
    });

    it('returns 409 when the email is already in use', async () => {
      adminsRepo.findOne.mockResolvedValue(makeAdmin());
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('returns 404 when the role does not exist', async () => {
      adminsRepo.findOne.mockResolvedValue(null);
      rolesRepo.findOne.mockResolvedValue(null);
      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update (SA-ADM-3)', () => {
    it('rehashes a new password and clears the refresh hash (session kill)', async () => {
      const admin = makeAdmin();
      adminsRepo.findOne.mockResolvedValue(admin);

      const updated = await service.update('admin-1', { password: 'NewPass12' });

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('NewPass12', 10);
      expect(updated.passwordHash).toBe('hashed-password');
      expect(updated.refreshTokenHash).toBeNull();
    });

    it('returns 409 when changing to an email already in use', async () => {
      const admin = makeAdmin();
      adminsRepo.findOne
        .mockResolvedValueOnce(admin) // findOne(id)
        .mockResolvedValueOnce(makeAdmin({ id: 'other' })); // email lookup
      await expect(
        service.update('admin-1', { email: 'taken@hotello.app' }),
      ).rejects.toThrow(ConflictException);
    });

    it('updates name and email (lowercased) on success', async () => {
      const admin = makeAdmin();
      adminsRepo.findOne
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(null);

      const updated = await service.update('admin-1', {
        name: 'Renamed',
        email: 'Renamed@Hotello.APP',
      });

      expect(updated.name).toBe('Renamed');
      expect(updated.email).toBe('renamed@hotello.app');
    });

    it('returns 404 for an unknown id', async () => {
      adminsRepo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStatus (SA-ADM-4)', () => {
    it('blocks self-deactivation with 400', async () => {
      await expect(
        service.updateStatus('admin-1', false, 'admin-1'),
      ).rejects.toThrow(
        new BadRequestException('You cannot deactivate your own account'),
      );
    });

    it('deactivation clears the refresh hash (kills the session)', async () => {
      const admin = makeAdmin();
      adminsRepo.findOne.mockResolvedValue(admin);

      const updated = await service.updateStatus('admin-1', false, 'other-admin');

      expect(updated.isActive).toBe(false);
      expect(updated.refreshTokenHash).toBeNull();
    });

    it('reactivates an admin without touching sessions', async () => {
      const admin = makeAdmin({ isActive: false, refreshTokenHash: null });
      adminsRepo.findOne.mockResolvedValue(admin);

      const updated = await service.updateStatus('admin-1', true, 'other-admin');

      expect(updated.isActive).toBe(true);
    });
  });

  describe('remove (SA-ADM-5)', () => {
    it('blocks self-deletion with 400', async () => {
      await expect(service.remove('admin-1', 'admin-1')).rejects.toThrow(
        new BadRequestException('You cannot delete your own account'),
      );
    });

    it('removes another admin', async () => {
      const admin = makeAdmin();
      adminsRepo.findOne.mockResolvedValue(admin);
      await service.remove('admin-1', 'other-admin');
      expect(adminsRepo.remove).toHaveBeenCalledWith(admin);
    });

    it('returns 404 for an unknown id', async () => {
      adminsRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('missing', 'other-admin')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
