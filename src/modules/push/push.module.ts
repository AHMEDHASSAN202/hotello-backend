import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PUSH_DRIVER } from './push.interface';
import { LogPushDriver } from './log-push.driver';
import { WebPushDriver } from './web-push.driver';

@Module({
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
  ],
  exports: [PUSH_DRIVER],
})
export class PushModule {}
