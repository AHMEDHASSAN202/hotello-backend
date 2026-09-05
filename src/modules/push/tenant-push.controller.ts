import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { PasswordChangeExempt } from '../../common/decorators/password-change-exempt.decorator';
import { SubscriptionExempt } from '../../common/decorators/subscription-exempt.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push.dto';
import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * Epic 26 (26.4 AC1) — staff push endpoints. Infra, not a feature: no
 * permission key, no module key (Epic 23 decision 8 pattern); the tenant
 * strategy's active-user check is the availability gate. Subscription-
 * exempt so a read-only hotel's worker can still sign out cleanly, and
 * password-change-exempt so a worker forced to change their password on
 * first login can still register their device for push before that flow
 * completes — deferring registration would mean missing the very first
 * task-assigned notifications after activation.
 */
@TenantScope()
@SubscriptionExempt()
@PasswordChangeExempt()
@Controller('tenant/push')
export class TenantPushController {
  constructor(
    private readonly subscriptions: PushSubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  /** The VAPID public key is not a secret; the tenant PWA needs it to subscribe. */
  @Get('config')
  getConfig(): { publicKey: string } {
    return { publicKey: this.config.get('VAPID_PUBLIC_KEY', '') };
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  async subscribe(@CurrentTenantUser() user: TenantUser, @Body() dto: SubscribePushDto) {
    await this.subscriptions.upsertForUser(user, dto);
    return { ok: true };
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  async unsubscribe(@CurrentTenantUser() user: TenantUser, @Body() dto: UnsubscribePushDto) {
    await this.subscriptions.removeForUser(user, dto.endpoint);
    return { ok: true };
  }
}
