import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateStaffDirectDto } from './dto/create-staff-direct.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { TenantStaffService } from './tenant-staff.service';

/**
 * Tenant staff management (Epic 09). @TenantScope() authenticates with the
 * tenant-jwt strategy; every action is permission-gated and hotel-scoped to
 * the authenticated user (hotel_id is never client-supplied). Mutations are
 * blocked when the subscription is read-only (TenantAccessGuard).
 */
@TenantScope()
@Controller('tenant/staff')
export class TenantStaffController {
  constructor(private readonly staffService: TenantStaffService) {}

  @Get()
  @RequirePermissions('staff.read')
  list(@CurrentTenantUser() user: TenantUser, @Query() query: ListStaffQueryDto) {
    return this.staffService.list(user, query);
  }

  @Post()
  @RequirePermissions('staff.invite')
  invite(@CurrentTenantUser() user: TenantUser, @Body() dto: InviteStaffDto) {
    return this.staffService.invite(user, dto);
  }

  /** Story 9.7 — create directly with a username + temporary password. */
  @Post('direct')
  @RequirePermissions('staff.invite')
  createDirect(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateStaffDirectDto,
  ) {
    return this.staffService.createDirect(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('staff.update')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.update(user, id, dto);
  }

  @Post(':id/disable')
  @RequirePermissions('staff.disable')
  disable(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staffService.disable(user, id);
  }

  @Post(':id/enable')
  @RequirePermissions('staff.disable')
  enable(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staffService.enable(user, id);
  }

  @Post(':id/resend-invite')
  @RequirePermissions('staff.invite')
  resendInvite(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staffService.resendInvite(user, id);
  }

  /** Story 9.8 — manager resets a staff member's password (temp password once). */
  @Post(':id/reset-password')
  @RequirePermissions('staff.update')
  resetPassword(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staffService.resetPassword(user, id);
  }
}
