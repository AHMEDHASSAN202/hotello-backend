import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentGuestStay } from '../../common/decorators/current-guest-stay.decorator';
import { GuestScope } from '../../common/decorators/guest-scope.decorator';
import { Stay } from '../tenant-stays/stay.entity';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push.dto';
import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * Epic 23, Stories 23.1/23.2 — guest browser push subscription lifecycle.
 * The guest JWT strategy already rejects requests from a dead stay/hotel
 * with 401 before a handler runs, so no availability check is needed here.
 */
@GuestScope()
@Controller('guest')
export class GuestPushController {
  constructor(
    private readonly subscriptions: PushSubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  /** The VAPID public key is not a secret; the guest app needs it to subscribe. */
  @Get('push/config')
  getConfig() {
    return { publicKey: this.config.get('VAPID_PUBLIC_KEY', '') };
  }

  @Post('push/subscriptions')
  @HttpCode(HttpStatus.OK)
  async subscribe(@CurrentGuestStay() stay: Stay, @Body() dto: SubscribePushDto) {
    await this.subscriptions.upsert(stay, dto);
    return { ok: true };
  }

  @Post('push/unsubscribe')
  @HttpCode(HttpStatus.OK)
  async unsubscribe(@CurrentGuestStay() stay: Stay, @Body() dto: UnsubscribePushDto) {
    await this.subscriptions.remove(stay, dto.endpoint);
    return { ok: true };
  }
}
