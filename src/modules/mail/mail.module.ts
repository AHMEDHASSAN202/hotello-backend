import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogMailDriver } from './log-mail.driver';
import { MAIL_DRIVER } from './mail.interface';
import { SmtpMailDriver } from './smtp-mail.driver';

/**
 * Global for the same reason as StorageModule: future channels (tenant staff
 * invites, guest notifications) inject MAIL_DRIVER without re-importing.
 * Driver selection is env-only (Story 6.2 AC1); `log` is the dev default.
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (config.get('MAIL_DRIVER', 'log') === 'smtp') {
          return new SmtpMailDriver({
            host: config.getOrThrow('SMTP_HOST'),
            port: parseInt(config.get('SMTP_PORT', '587'), 10),
            secure: config.get('SMTP_SECURE', 'false') === 'true',
            user: config.get('SMTP_USER') || undefined,
            pass: config.get('SMTP_PASS') || undefined,
            fromAddress: config.getOrThrow('MAIL_FROM_ADDRESS'),
            fromName: config.get('MAIL_FROM_NAME', 'GXP Platform'),
          });
        }
        return new LogMailDriver();
      },
    },
  ],
  exports: [MAIL_DRIVER],
})
export class MailModule {}
