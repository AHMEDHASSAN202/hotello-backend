import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PUSH_DRIVER } from './push.interface';
import { LogPushDriver } from './log-push.driver';
import { WebPushDriver } from './web-push.driver';
import { PushSubscription } from './push-subscription.entity';
import { PushDispatch } from './push-dispatch.entity';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { GuestPushController } from './guest-push.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription, PushDispatch])],
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
  ],
  exports: [PUSH_DRIVER, PushSubscriptionsService],
})
export class PushModule {}
