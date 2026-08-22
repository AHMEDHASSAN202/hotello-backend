import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { PasswordChangeExempt } from '../../common/decorators/password-change-exempt.decorator';
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
@PasswordChangeExempt()
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

  /**
   * Epic 12, Story 12.4 AC2 — dismiss a first-run HintCard. Rides on the
   * profile controller (user-scoped, no permission needed) and inherits
   * @SubscriptionExempt: hint dismissal must work in read-only mode.
   */
  @Post('hints/:key/dismiss')
  @HttpCode(204)
  dismissHint(
    @CurrentTenantUser() user: TenantUser,
    @Param('key') key: string,
  ) {
    return this.profile.dismissHint(user, key);
  }

  /**
   * Epic 15 — un-dismiss: removes a stored hint key so keys can serve as
   * per-user toggles (the requests-board sound mute). Idempotent.
   */
  @Delete('hints/:key')
  @HttpCode(204)
  undismissHint(
    @CurrentTenantUser() user: TenantUser,
    @Param('key') key: string,
  ) {
    return this.profile.undismissHint(user, key);
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
