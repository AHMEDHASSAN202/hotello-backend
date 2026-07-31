import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateTenantRoleDto } from './dto/create-tenant-role.dto';
import { UpdateTenantRoleDto } from './dto/update-tenant-role.dto';
import { TenantRolesService } from './tenant-roles.service';

/**
 * Tenant Roles & Permissions (Epic 10). Two clearly-named list endpoints
 * (spec note #2): the lightweight `/options` dropdown stays on `staff.read` so
 * Front-Desk-type roles can still invite; the full management surface (list,
 * catalog, CRUD) is gated on `roles.*`. `hotel_id` is always the authenticated
 * user's — never client-sent.
 */
@TenantScope()
@Controller('tenant/roles')
export class TenantRolesController {
  constructor(private readonly rolesService: TenantRolesService) {}

  /** Lightweight role list for the staff invite/edit dropdowns (Epic 09). */
  @Get('options')
  @RequirePermissions('staff.read')
  async options(@CurrentTenantUser() user: TenantUser) {
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

  /** Story 10.5 — the localized, module-filtered permission catalog. */
  @Get('permissions/catalog')
  @RequirePermissions('roles.read')
  getCatalog(@CurrentTenantUser() user: TenantUser) {
    return this.rolesService.getCatalog(user.hotelId);
  }

  /** Story 10.1 — the roles-management list with staff counts. */
  @Get()
  @RequirePermissions('roles.read')
  list(@CurrentTenantUser() user: TenantUser) {
    return this.rolesService.getManagementList(user.hotelId);
  }

  /** Story 10.1 AC3 — a single role's detail. */
  @Get(':id')
  @RequirePermissions('roles.read')
  detail(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rolesService.getDetail(user.hotelId, id);
  }

  /** Story 10.2 — create a custom role. */
  @Post()
  @RequirePermissions('roles.create')
  create(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateTenantRoleDto,
  ) {
    return this.rolesService.createRole(user, dto);
  }

  /** Story 10.3 — edit a role. */
  @Patch(':id')
  @RequirePermissions('roles.update')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantRoleDto,
  ) {
    return this.rolesService.updateRole(user, id, dto);
  }

  /** Story 10.4 — delete a role. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('roles.delete')
  remove(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rolesService.deleteRole(user, id);
  }
}
