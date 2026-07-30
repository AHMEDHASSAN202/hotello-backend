import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DEFAULT_TENANT_ROLES } from './default-tenant-roles';
import { TenantRole } from './tenant-role.entity';

@Injectable()
export class TenantRolesService {
  constructor(
    @InjectRepository(TenantRole)
    private readonly rolesRepo: Repository<TenantRole>,
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
   * Story 9.1 AC3 — the Owner (system) role is immutable. Enforced here at the
   * service layer so Epic 10's CRUD can reuse it.
   */
  assertNotSystemMutation(role: TenantRole): void {
    if (role.isSystem) {
      throw new BadRequestException({
        code: 'SYSTEM_ROLE_READONLY',
        message: 'System roles cannot be modified',
      });
    }
  }
}
