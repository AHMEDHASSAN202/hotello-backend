import { Controller, Get } from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantRolesService } from './tenant-roles.service';

/**
 * Read-only role list for the staff invite/edit dropdowns (Epic 09). Gated by
 * `staff.read` — spec note #2 accepts this until Epic 10 introduces the full
 * role catalog + `roles.read`. `hotel_id` is always the authenticated user's.
 */
@TenantScope()
@Controller('tenant/roles')
export class TenantRolesController {
  constructor(private readonly rolesService: TenantRolesService) {}

  @Get()
  @RequirePermissions('staff.read')
  async list(@CurrentTenantUser() user: TenantUser) {
    const roles = await this.rolesService.listForHotel(user.hotelId);
    return roles.map((role) => ({
      id: role.id,
      nameEn: role.nameEn,
      nameAr: role.nameAr,
      descriptionEn: role.descriptionEn,
      descriptionAr: role.descriptionAr,
      isSystem: role.isSystem,
      permissions: role.permissions,
    }));
  }
}
