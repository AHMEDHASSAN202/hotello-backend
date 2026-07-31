import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantRolesService } from '../tenant-roles/tenant-roles.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { TenantStaffService } from './tenant-staff.service';

const HOTEL_ID = 'hotel-1';

const makeRole = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'role-mgr',
  nameEn: 'Manager',
  nameAr: 'المدير',
  isSystem: false,
  permissions: ['staff.read'],
  ...o,
});

const ownerRole = makeRole({ id: 'role-owner', isSystem: true, permissions: ['*'] });

const makeActor = (o: Record<string, unknown> = {}): TenantUser =>
  ({
    id: 'actor-1',
    hotelId: HOTEL_ID,
    name: 'Boss',
    email: 'boss@hotel.example',
    roleId: 'role-owner',
    role: ownerRole,
    status: 'active',
    ...o,
  }) as unknown as TenantUser;

const makeStaff = (o: Record<string, unknown> = {}): TenantUser =>
  ({
    id: 'staff-1',
    hotelId: HOTEL_ID,
    name: 'Sam Staff',
    email: 'sam@hotel.example',
    roleId: 'role-mgr',
    role: makeRole(),
    status: 'active',
    passwordHash: 'hash',
    refreshTokenHash: 'rt',
    setupTokenHash: null,
    setupTokenExpiresAt: null,
    inviteSentAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...o,
  }) as unknown as TenantUser;

describe('TenantStaffService', () => {
  let service: TenantStaffService;
  let usersRepo: { findOne: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let rolesService: { findInHotel: jest.Mock };
  let subscriptions: { getForHotel: jest.Mock };
  let tenantUsers: { issueSetupToken: jest.Mock; buildLoginLink: jest.Mock };
  let auditLogs: { log: jest.Mock; countSince: jest.Mock };
  let events: { emitAsync: jest.Mock };

  // Transaction manager wiring — configurable seat count per test.
  let seatCounts: number[]; // consumed in order by countSeats
  let managerHotel: { findOne: jest.Mock; save: jest.Mock };
  let managerUsers: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  const countQb = () => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['leftJoin', 'where', 'andWhere']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getCount = jest.fn(async () =>
      seatCounts.length > 1 ? seatCounts.shift()! : seatCounts[0],
    );
    return qb;
  };

  const listQb = (rows: TenantUser[], total: number) => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of [
      'leftJoinAndSelect',
      'where',
      'andWhere',
      'orderBy',
      'skip',
      'take',
    ]) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getManyAndCount = jest.fn(async () => [rows, total]);
    return qb;
  };

  beforeEach(async () => {
    seatCounts = [0];
    managerHotel = {
      findOne: jest.fn().mockResolvedValue({
        id: HOTEL_ID,
        nameEn: 'Grand',
        nameAr: 'جراند',
        slug: 'grand',
        defaultLanguage: 'en',
        staffUsersCount: 0,
      }),
      save: jest.fn(async (h) => h),
    };
    managerUsers = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'staff-new', createdAt: new Date(), ...d })),
      save: jest.fn(async (u) => u),
      createQueryBuilder: jest.fn(() => countQb()),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === Hotel ? managerHotel : managerUsers,
      ),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };

    usersRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (u) => u),
      createQueryBuilder: jest.fn(() => listQb([], 0)),
    };
    hotelsRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: HOTEL_ID,
        nameEn: 'Grand',
        nameAr: 'جراند',
        slug: 'grand',
        defaultLanguage: 'en',
      }),
    };
    rolesService = { findInHotel: jest.fn().mockResolvedValue(makeRole()) };
    subscriptions = {
      getForHotel: jest
        .fn()
        .mockResolvedValue({ current: { plan: { maxStaffUsers: 5 } } }),
    };
    tenantUsers = {
      issueSetupToken: jest.fn().mockResolvedValue({
        raw: 'raw-token',
        expiresAt: new Date('2026-08-01T00:00:00Z'),
      }),
      buildLoginLink: jest.fn((slug: string) => `https://${slug}.gxp.example/login`),
    };
    auditLogs = { log: jest.fn(), countSince: jest.fn().mockResolvedValue(0) };
    events = { emitAsync: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantStaffService,
        { provide: getRepositoryToken(TenantUser), useValue: usersRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: TenantRolesService, useValue: rolesService },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: TenantUsersService, useValue: tenantUsers },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = moduleRef.get(TenantStaffService);
  });

  describe('staff list (9.2)', () => {
    it('AC3 — scopes every query to the actor hotel and returns the page shape', async () => {
      const qb = listQb([makeStaff()], 1);
      usersRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list(makeActor(), { page: 1, pageSize: 20 });

      expect(qb.where).toHaveBeenCalledWith('u.hotelId = :hotelId', {
        hotelId: HOTEL_ID,
      });
      expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(result.data[0]).toMatchObject({
        id: 'staff-1',
        role: { nameEn: 'Manager' },
      });
    });

    it('applies search, role and status filters', async () => {
      const qb = listQb([], 0);
      usersRepo.createQueryBuilder.mockReturnValue(qb);
      await service.list(makeActor(), {
        search: 'sam',
        roleId: 'role-mgr',
        status: 'active',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(u.name ILIKE :search OR u.email ILIKE :search)',
        { search: '%sam%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('u.roleId = :roleId', {
        roleId: 'role-mgr',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('u.status = :status', {
        status: 'active',
      });
    });
  });

  describe('invite staff (9.3)', () => {
    const dto = { name: 'New Hire', email: 'New@Hotel.Example', roleId: 'role-mgr' };

    it('creates a pending user with a setup token, updates the counter, audits and emits', async () => {
      const result = await service.invite(makeActor(), dto);

      // Locked the hotel row before counting/inserting (spec note #4).
      expect(managerHotel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(managerUsers.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelId: HOTEL_ID,
          email: 'new@hotel.example',
          roleId: 'role-mgr',
          status: 'pending',
        }),
      );
      expect(tenantUsers.issueSetupToken).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
      );
      expect(managerHotel.save).toHaveBeenCalledWith(
        expect.objectContaining({ staffUsersCount: 1 }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'staff.invited',
          metadata: expect.objectContaining({
            inviteeEmail: 'new@hotel.example',
            roleId: 'role-mgr',
          }),
        }),
      );
      expect(events.emitAsync).toHaveBeenCalledWith(
        'tenant_user.staff_invite_requested',
        expect.objectContaining({ rawToken: 'raw-token', roleNameEn: 'Manager' }),
      );
      expect(result).toMatchObject({ status: 'pending', email: 'new@hotel.example' });
    });

    it('AC1 — a duplicate email in the hotel is rejected with 422', async () => {
      managerUsers.findOne.mockResolvedValue(makeStaff());
      await expect(service.invite(makeActor(), dto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('AC1 — the Owner (system) role cannot be assigned', async () => {
      rolesService.findInHotel.mockResolvedValue(ownerRole);
      await expect(service.invite(makeActor(), dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s an unknown/cross-tenant role', async () => {
      rolesService.findInHotel.mockRejectedValue(
        new NotFoundException({ code: 'ROLE_NOT_FOUND' }),
      );
      await expect(service.invite(makeActor(), dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('AC2 — rejects with 409 (carrying the limit) when the plan seat cap is reached', async () => {
      seatCounts = [5];
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxStaffUsers: 5 } },
      });
      await expect(service.invite(makeActor(), dto)).rejects.toMatchObject({
        response: { code: 'STAFF_LIMIT_REACHED', limit: 5 },
      });
    });

    it('AC2 — a null limit means unlimited', async () => {
      seatCounts = [999];
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxStaffUsers: null } },
      });
      await expect(service.invite(makeActor(), dto)).resolves.toBeDefined();
    });

    it('AC2 race — two invites for the last seat: first succeeds, second 409', async () => {
      seatCounts = [0, 1]; // count returns 0 then 1 across the two transactions
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxStaffUsers: 1 } },
      });
      await expect(
        service.invite(makeActor(), { ...dto, email: 'a@hotel.example' }),
      ).resolves.toBeDefined();
      await expect(
        service.invite(makeActor(), { ...dto, email: 'b@hotel.example' }),
      ).rejects.toMatchObject({ response: { code: 'STAFF_LIMIT_REACHED' } });
    });
  });

  describe('edit staff (9.4)', () => {
    it('updates name and role and audits the diff', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff());
      rolesService.findInHotel.mockResolvedValue(makeRole({ id: 'role-fd', nameEn: 'Front Desk' }));

      await service.update(makeActor(), 'staff-1', {
        name: 'Renamed',
        roleId: 'role-fd',
      });

      expect(usersRepo.save).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'staff.updated',
          metadata: expect.objectContaining({
            diff: expect.objectContaining({
              name: { from: 'Sam Staff', to: 'Renamed' },
              roleId: { from: 'role-mgr', to: 'role-fd' },
            }),
          }),
        }),
      );
    });

    it('AC2 — the owner account cannot be edited here', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ role: ownerRole }));
      await expect(
        service.update(makeActor(), 'staff-1', { name: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'CANNOT_EDIT_OWNER' } });
    });

    it('AC2 — no one can be promoted to the Owner role', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff());
      rolesService.findInHotel.mockResolvedValue(ownerRole);
      await expect(
        service.update(makeActor(), 'staff-1', { roleId: 'role-owner' }),
      ).rejects.toMatchObject({ response: { code: 'OWNER_ROLE_NOT_ASSIGNABLE' } });
    });

    it('AC3 — a user cannot change their own role', async () => {
      const self = makeStaff({ id: 'actor-1', role: makeRole() });
      usersRepo.findOne.mockResolvedValue(self);
      await expect(
        service.update(makeActor(), 'actor-1', { roleId: 'role-fd' }),
      ).rejects.toMatchObject({ response: { code: 'CANNOT_CHANGE_OWN_ROLE' } });
    });

    it('AC3 — 404 for a cross-tenant id', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update(makeActor(), 'ghost', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'ghost', hotelId: HOTEL_ID },
        relations: ['role'],
      });
    });
  });

  describe('disable / enable staff (9.5)', () => {
    it('AC1/AC3 — disable clears the refresh hash and the pending setup token', async () => {
      const pending = makeStaff({
        status: 'pending',
        refreshTokenHash: 'rt',
        setupTokenHash: 'sth',
        setupTokenExpiresAt: new Date(),
      });
      usersRepo.findOne.mockResolvedValue(pending);
      seatCounts = [0];

      await service.disable(makeActor(), 'staff-1');

      expect(pending.status).toBe('disabled');
      expect(pending.refreshTokenHash).toBeNull();
      expect(pending.setupTokenHash).toBeNull();
      expect(pending.setupTokenExpiresAt).toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.disabled' }),
      );
    });

    it('AC2 — the owner cannot be disabled', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ role: ownerRole }));
      await expect(service.disable(makeActor(), 'staff-1')).rejects.toMatchObject({
        response: { code: 'CANNOT_DISABLE_OWNER' },
      });
    });

    it('AC2 — a user cannot disable themselves', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ id: 'actor-1' }));
      await expect(service.disable(makeActor(), 'actor-1')).rejects.toMatchObject({
        response: { code: 'CANNOT_DISABLE_SELF' },
      });
    });

    it('rejects disabling an already-disabled member', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ status: 'disabled' }));
      await expect(service.disable(makeActor(), 'staff-1')).rejects.toMatchObject({
        response: { code: 'STAFF_ALREADY_DISABLED' },
      });
    });

    it('AC4 — enable restores active when a password exists', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeStaff({ status: 'disabled', passwordHash: 'hash' }),
      );
      const result = await service.enable(makeActor(), 'staff-1');
      expect(result.status).toBe('active');
    });

    it('AC4 — enable restores pending when the user never activated', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeStaff({ status: 'disabled', passwordHash: null }),
      );
      const result = await service.enable(makeActor(), 'staff-1');
      expect(result.status).toBe('pending');
    });

    it('enable re-checks the seat limit (user-confirmed)', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ status: 'disabled' }));
      seatCounts = [5];
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxStaffUsers: 5 } },
      });
      await expect(service.enable(makeActor(), 'staff-1')).rejects.toMatchObject({
        response: { code: 'STAFF_LIMIT_REACHED' },
      });
    });

    it('rejects enabling a member who is not disabled', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ status: 'active' }));
      await expect(service.enable(makeActor(), 'staff-1')).rejects.toMatchObject({
        response: { code: 'STAFF_NOT_DISABLED' },
      });
    });
  });

  describe('resend invite (9.6)', () => {
    it('AC1 — issues a new token and emits, for a pending user', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeStaff({ status: 'pending', inviteSentAt: null }),
      );
      await service.resendInvite(makeActor(), 'staff-1');
      expect(tenantUsers.issueSetupToken).toHaveBeenCalled();
      expect(events.emitAsync).toHaveBeenCalledWith(
        'tenant_user.staff_invite_requested',
        expect.objectContaining({ rawToken: 'raw-token' }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.invite_resent' }),
      );
    });

    it('rejects resending to a non-pending user', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ status: 'active' }));
      await expect(
        service.resendInvite(makeActor(), 'staff-1'),
      ).rejects.toMatchObject({ response: { code: 'RESEND_ONLY_PENDING' } });
    });

    it('AC2 — enforces the 10-minute cooldown with a 429 and retryAfterSeconds', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeStaff({ status: 'pending', inviteSentAt: new Date(Date.now() - 60_000) }),
      );
      await expect(service.resendInvite(makeActor(), 'staff-1')).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(tenantUsers.issueSetupToken).not.toHaveBeenCalled();
    });

    it('AC2 — allows a resend once the cooldown has elapsed', async () => {
      usersRepo.findOne.mockResolvedValue(
        makeStaff({
          status: 'pending',
          inviteSentAt: new Date(Date.now() - 11 * 60_000),
        }),
      );
      await expect(
        service.resendInvite(makeActor(), 'staff-1'),
      ).resolves.toBeDefined();
      expect(tenantUsers.issueSetupToken).toHaveBeenCalled();
    });
  });

  describe('create directly (9.7)', () => {
    const dto = {
      name: 'Ground Staff',
      username: 'Ground.Staff',
      roleId: 'role-mgr',
    };

    it('creates an active username account with mustChangePassword and returns the temp password once', async () => {
      const result = await service.createDirect(makeActor(), dto);

      expect(managerUsers.save).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'ground.staff', // lowercased (AC2)
          email: null,
          status: 'active',
          mustChangePassword: true, // AC4
        }),
      );
      expect(managerHotel.save).toHaveBeenCalledWith(
        expect.objectContaining({ staffUsersCount: 1 }),
      );
      expect(result.credentials.username).toBe('ground.staff');
      expect(result.credentials.tempPassword).toEqual(expect.any(String));
      expect(result.credentials.loginUrl).toContain('/login');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'staff.created_direct',
          metadata: expect.objectContaining({ username: 'ground.staff' }),
        }),
      );
      // AC8 — the password is never in the audit metadata.
      const auditMeta = auditLogs.log.mock.calls.at(-1)![0].metadata;
      expect(JSON.stringify(auditMeta)).not.toContain(
        result.credentials.tempPassword,
      );
      // No email → no welcome email.
      expect(events.emitAsync).not.toHaveBeenCalled();
    });

    it('AC2 — a provided password is used instead of a generated one', async () => {
      const result = await service.createDirect(makeActor(), {
        ...dto,
        password: 'Chosen123',
      });
      expect(result.credentials.tempPassword).toBe('Chosen123');
    });

    it('AC7 — queues a welcome email only when an email is present and requested', async () => {
      await service.createDirect(makeActor(), {
        ...dto,
        email: 'Ground@Hotel.Example',
        sendWelcomeEmail: true,
      });
      expect(events.emitAsync).toHaveBeenCalledWith(
        'tenant_user.staff_welcome_requested',
        expect.objectContaining({
          username: 'ground.staff',
          userEmail: 'ground@hotel.example',
        }),
      );
    });

    it('AC2 — rejects a username already taken in the hotel (422)', async () => {
      managerUsers.findOne.mockResolvedValueOnce(makeStaff()); // username lookup hit
      await expect(service.createDirect(makeActor(), dto)).rejects.toMatchObject({
        response: { code: 'USERNAME_TAKEN' },
      });
    });

    it('the Owner role cannot be assigned', async () => {
      rolesService.findInHotel.mockResolvedValue(ownerRole);
      await expect(service.createDirect(makeActor(), dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('AC6 — counts toward the seat limit like invites (409 at the cap)', async () => {
      seatCounts = [5];
      subscriptions.getForHotel.mockResolvedValue({
        current: { plan: { maxStaffUsers: 5 } },
      });
      await expect(service.createDirect(makeActor(), dto)).rejects.toMatchObject({
        response: { code: 'STAFF_LIMIT_REACHED' },
      });
    });
  });

  describe('reset password (9.8)', () => {
    it('AC1/AC2 — issues a temp password, forces change, kills sessions + tokens', async () => {
      const target = makeStaff({
        status: 'active',
        refreshTokenHash: 'rt',
        setupTokenHash: 'sth',
      });
      usersRepo.findOne.mockResolvedValue(target);

      const result = await service.resetPassword(makeActor(), 'staff-1');

      expect(target.mustChangePassword).toBe(true);
      expect(target.refreshTokenHash).toBeNull();
      expect(target.setupTokenHash).toBeNull();
      expect(result.credentials.tempPassword).toEqual(expect.any(String));
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.password_reset_by_manager' }),
      );
      const auditMeta = auditLogs.log.mock.calls.at(-1)![0].metadata;
      expect(JSON.stringify(auditMeta)).not.toContain(
        result.credentials.tempPassword,
      );
    });

    it('AC3 — cannot reset the owner', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ role: ownerRole }));
      await expect(service.resetPassword(makeActor(), 'staff-1')).rejects.toMatchObject(
        { response: { code: 'CANNOT_RESET_OWNER' } },
      );
    });

    it('AC3 — cannot reset yourself', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ id: 'actor-1' }));
      await expect(service.resetPassword(makeActor(), 'actor-1')).rejects.toMatchObject(
        { response: { code: 'CANNOT_RESET_SELF' } },
      );
    });

    it('AC4 — enforces the per-target hourly rate limit (429)', async () => {
      usersRepo.findOne.mockResolvedValue(makeStaff({ status: 'active' }));
      auditLogs.countSince.mockResolvedValue(3);
      await expect(service.resetPassword(makeActor(), 'staff-1')).rejects.toBeInstanceOf(
        HttpException,
      );
    });
  });
});
