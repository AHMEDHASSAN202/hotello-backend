import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventBooking } from '../events/event-booking.entity';
import { Event } from '../events/event.entity';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { Hotel } from '../hotels/hotel.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { PUSH_DRIVER } from './push.interface';
import { LogPushDriver } from './log-push.driver';
import { WebPushDriver } from './web-push.driver';
import { PushSubscription } from './push-subscription.entity';
import { PushDispatch } from './push-dispatch.entity';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushDispatchService } from './push-dispatch.service';
import { PushRemindersService } from './push-reminders.service';
import { PushRetryService } from './push-retry.service';
import { PushService } from './push.service';
import { GuestPushController } from './guest-push.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PushSubscription,
      PushDispatch,
      Stay,
      EventBooking,
      Event,
      FnbOrder,
      Hotel,
    ]),
  ],
  controllers: [GuestPushController],
  providers: [
    {
      provide: PUSH_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('PUSH_DRIVER', 'log') === 'webpush'
          ? new WebPushDriver({
              publicKey: config.get('VAPID_PUBLIC_KEY', ''),
              privateKey: config.get('VAPID_PRIVATE_KEY', ''),
              subject: config.get('VAPID_SUBJECT', 'mailto:ops@gxp.app'),
            })
          : new LogPushDriver(),
    },
    PushSubscriptionsService,
    PushDispatchService,
    PushRetryService,
    PushService,
    PushRemindersService,
  ],
  exports: [PUSH_DRIVER, PushSubscriptionsService, PushDispatchService, PushService],
})
export class PushModule {}
