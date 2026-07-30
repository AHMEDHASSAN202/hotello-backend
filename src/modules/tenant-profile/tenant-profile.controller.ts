import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { SubscriptionExempt } from '../../common/decorators/subscription-exempt.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantChangePasswordDto } from './dto/tenant-change-password.dto';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';
import { TenantProfileService } from './tenant-profile.service';

/**
 * Own-profile routes. @SubscriptionExempt() so they keep working even when the
 * subscription is expired (read-only) — a user must always be able to read
 * their context and manage their own account (Story 8.6 note 5).
 */
@TenantScope()
@SubscriptionExempt()
@Controller('tenant/me')
export class TenantProfileController {
  constructor(private readonly profile: TenantProfileService) {}

  @Get()
  me(@CurrentTenantUser() user: TenantUser) {
    return this.profile.me(user);
  }

  @Patch()
  update(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: UpdateTenantProfileDto,
  ) {
    return this.profile.updateProfile(user, dto);
  }

  @Post('change-password')
  @HttpCode(204)
  changePassword(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: TenantChangePasswordDto,
  ) {
    return this.profile.changePassword(user, dto);
  }
}
