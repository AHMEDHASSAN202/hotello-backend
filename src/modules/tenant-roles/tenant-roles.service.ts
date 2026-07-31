import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, Not, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  ALL_TENANT_PERMISSION_KEYS,
  TENANT_PERMISSION_CATALOG,
  TenantPermissionGroup,
  WILDCARD,
} from '../tenant-users/tenant-permissions.constants';
import { CreateTenantRoleDto } from './dto/create-tenant-role.dto';
import { UpdateTenantRoleDto } from './dto/update-tenant-role.dto';
import { DEFAULT_TENANT_ROLES } from './default-tenant-roles';
import { TenantRole } from './tenant-role.entity';

/** A role plus its assigned-staff count (Story 10.1 AC2). */
export interface TenantRoleWithCount extends TenantRole {
  staffCount: number;
}

@Injectable()
export class TenantRolesService {
  constructor(
    @InjectRepository(TenantRole)
    private readonly rolesRepo: Repository<TenantRole>,
    @InjectRepository(TenantUser)
    private readonly usersRepo: Repository<TenantUser>,
    private readonly auditLogs: AuditLogsService,
    private readonly access: TenantAccessService,
  ) {}

  /**
   * Story 9.1 AC1/AC2 — seed the default roles for a hotel. Idempotent:
   * find-or-create by (hotelId, nameEn), so it is safe to run on onboarding,
   * from the seed script, and as a backfill for existing hotels. Accepts an
   * optional EntityManager so it can join the onboarding transaction.
   */
  async seedDefaultRoles(
    hotelId: string,
    manager?: EntityManager,
  ): Promise<TenantRole[]> {
    const repo = manager ? manager.getRepository(TenantRole) : this.rolesRepo;
    const result: TenantRole[] = [];
    for (const def of DEFAULT_TENANT_ROLES) {
      const existing = await repo.findOne({
        where: { hotelId, nameEn: def.nameEn },
      });
      if (existing) {
        result.push(existing);
        continue;
      }
      result.push(await repo.save(repo.create({ hotelId, ...def })));
    }
    return result;
  }

  /** Story 9.2 note — roles for the invite/edit dropdowns, hotel-scoped. */
  async listForHotel(hotelId: string): Promise<TenantRole[]> {
    return this.rolesRepo.find({
      where: { hotelId },
      order: { isSystem: 'DESC', createdAt: 'ASC' },
    });
  }

  /**
   * Story 10.1 AC2 — the roles-management list, each with its assigned-staff
   * count. Ordered system-first, then creation order.
   */
  async getManagementList(hotelId: string): Promise<TenantRoleWithCount[]> {
    const roles = await this.listForHotel(hotelId);
    return Promise.all(
      roles.map(async (role) => ({
        ...role,
        staffCount: await this.usersRepo.count({
          where: { hotelId, roleId: role.id },
        }),
      })),
    );
  }

  /** Story 10.1 AC3 — a single role with its assigned-staff count. */
  async getDetail(hotelId: string, roleId: string): Promise<TenantRoleWithCount> {
    const role = await this.findInHotel(hotelId, roleId);
    const staffCount = await this.usersRepo.count({
      where: { hotelId, roleId: role.id },
    });
    return { ...role, staffCount };
  }

  /**
   * Story 10.5 AC1/AC3 — the permission catalog the matrix renders from,
   * filtered by the hotel's enabled modules. Core groups (no `module`) are
   * always included; a module-gated group is dropped when the module is not in
   * the plan (its permissions stay dormant on any role — module gate is checked
   * before the permission gate in the request guards).
   */
  async getCatalog(hotelId: string): Promise<TenantPermissionGroup[]> {
    const state = await this.access.getAccessState(hotelId);
    return TENANT_PERMISSION_CATALOG.filter(
      (group) => !group.module || state.enabledModules.includes(group.module),
    );
  }

  /**
   * Story 9.3/9.4 — resolve a role within the hotel. Cross-tenant or unknown
   * ids return 404 (never confirm another hotel's roles exist).
   */
  async findInHotel(hotelId: string, roleId: string): Promise<TenantRole> {
    const role = await this.rolesRepo.findOne({ where: { id: roleId, hotelId } });
    if (!role) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found',
      });
    }
    return role;
  }

  /**
   * Story 9.1 AC3 / 10.3 AC1 — the Owner (system) role is immutable. Enforced
   * here at the service layer so Epic 10's CRUD reuses it. 403 (not 400): a
   * system role is a permanent constraint, not a bad request.
   */
  assertNotSystemMutation(role: TenantRole): void {
    if (role.isSystem) {
      throw new ForbiddenException({
        code: 'SYSTEM_ROLE_READONLY',
        message: 'System roles cannot be modified',
      });
    }
  }

  /** Story 10.2 — create a custom role. */
  async createRole(
    actor: TenantUser,
    dto: CreateTenantRoleDto,
  ): Promise<TenantRole> {
    this.assertAssignablePermissions(dto.permissions);
    this.assertNoEscalation(actor, dto.permissions);
    await this.assertNameAvailable(actor.hotelId, dto.nameEn, dto.nameAr);

    const role = await this.rolesRepo.save(
      this.rolesRepo.create({
        hotelId: actor.hotelId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        descriptionEn: dto.descriptionEn ?? null,
        descriptionAr: dto.descriptionAr ?? null,
        permissions: dto.permissions,
        isSystem: false,
      }),
    );

    await this.auditLogs.log({
      action: 'role.created',
      entityType: 'tenant_role',
      entityId: role.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        nameEn: role.nameEn,
        nameAr: role.nameAr,
        permissions: role.permissions,
      },
    });

    return role;
  }

  /** Story 10.3 — edit a role's details and permissions. */
  async updateRole(
    actor: TenantUser,
    roleId: string,
    dto: UpdateTenantRoleDto,
  ): Promise<TenantRole> {
    const role = await this.findInHotel(actor.hotelId, roleId);
    this.assertNotSystemMutation(role);

    if (dto.permissions) {
      this.assertAssignablePermissions(dto.permissions);
      this.assertNoEscalation(actor, dto.permissions);
    }
    if (dto.nameEn || dto.nameAr) {
      await this.assertNameAvailable(
        actor.hotelId,
        dto.nameEn ?? role.nameEn,
        dto.nameAr ?? role.nameAr,
        role.id,
      );
    }

    const before = {
      nameEn: role.nameEn,
      nameAr: role.nameAr,
      descriptionEn: role.descriptionEn,
      descriptionAr: role.descriptionAr,
      permissions: role.permissions,
    };

    if (dto.nameEn !== undefined) role.nameEn = dto.nameEn;
    if (dto.nameAr !== undefined) role.nameAr = dto.nameAr;
    if (dto.descriptionEn !== undefined) role.descriptionEn = dto.descriptionEn;
    if (dto.descriptionAr !== undefined) role.descriptionAr = dto.descriptionAr;
    if (dto.permissions !== undefined) role.permissions = dto.permissions;

    const saved = await this.rolesRepo.save(role);

    await this.auditLogs.log({
      action: 'role.updated',
      entityType: 'tenant_role',
      entityId: saved.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        before,
        after: {
          nameEn: saved.nameEn,
          nameAr: saved.nameAr,
          descriptionEn: saved.descriptionEn,
          descriptionAr: saved.descriptionAr,
          permissions: saved.permissions,
        },
      },
    });

    return saved;
  }

  /** Story 10.4 — delete a role (hard delete; unassigned only). */
  async deleteRole(actor: TenantUser, roleId: string): Promise<void> {
    const role = await this.findInHotel(actor.hotelId, roleId);
    if (role.isSystem) {
      throw new ForbiddenException({
        code: 'SYSTEM_ROLE_READONLY',
        message: 'System roles cannot be deleted',
      });
    }

    const staffCount = await this.usersRepo.count({
      where: { hotelId: actor.hotelId, roleId: role.id },
    });
    if (staffCount > 0) {
      throw new ConflictException({
        code: 'ROLE_IN_USE',
        message: `Role is assigned to ${staffCount} staff member(s)`,
        staffCount,
      });
    }

    await this.rolesRepo.remove(role);

    await this.auditLogs.log({
      action: 'role.deleted',
      entityType: 'tenant_role',
      entityId: roleId,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        nameEn: role.nameEn,
        nameAr: role.nameAr,
        permissions: role.permissions,
      },
    });
  }

  /**
   * Story 10.2 AC2 — only catalog permissions are accepted (422 otherwise), and
   * the wildcard is Owner-only (never assignable to a custom role).
   */
  private assertAssignablePermissions(permissions: string[]): void {
    if (permissions.includes(WILDCARD)) {
      throw new UnprocessableEntityException({
        code: 'WILDCARD_NOT_ASSIGNABLE',
        message: 'The full-access wildcard cannot be assigned to a custom role',
      });
    }
    const invalid = permissions.filter(
      (key) => !ALL_TENANT_PERMISSION_KEYS.includes(key),
    );
    if (invalid.length > 0) {
      throw new UnprocessableEntityException({
        code: 'INVALID_PERMISSIONS',
        message: `Unknown permission keys: ${invalid.join(', ')}`,
        permissions: invalid,
      });
    }
  }

  /**
   * Story 10.2 AC3 / 10.3 AC1 — a user can only grant permissions they hold.
   * Owner (`*`) holders are unaffected. Returns the offending keys so the UI can
   * point at them precisely (note 4).
   */
  private assertNoEscalation(actor: TenantUser, requested: string[]): void {
    const held = actor.role?.permissions ?? [];
    if (held.includes(WILDCARD)) return;
    const offending = requested.filter((key) => !held.includes(key));
    if (offending.length > 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_ESCALATION',
        message: 'You can only grant permissions you hold',
        permissions: offending,
      });
    }
  }

  /**
   * Story 10.2 AC2 — role names are unique within a hotel per language,
   * case-insensitive. DB unique constraints back this up; this gives a clean
   * 409 with a machine-readable code before hitting them.
   */
  private async assertNameAvailable(
    hotelId: string,
    nameEn: string,
    nameAr: string,
    excludeId?: string,
  ): Promise<void> {
    const clashEn = await this.rolesRepo.findOne({
      where: excludeId
        ? { hotelId, nameEn: ILike(nameEn), id: Not(excludeId) }
        : { hotelId, nameEn: ILike(nameEn) },
    });
    const clashAr = await this.rolesRepo.findOne({
      where: excludeId
        ? { hotelId, nameAr: ILike(nameAr), id: Not(excludeId) }
        : { hotelId, nameAr: ILike(nameAr) },
    });
    if (clashEn || clashAr) {
      throw new ConflictException({
        code: 'ROLE_NAME_TAKEN',
        message: 'A role with this name already exists',
      });
    }
  }
}
