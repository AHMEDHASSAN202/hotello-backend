import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LogMailDriver } from './log-mail.driver';
import { MAIL_DRIVER } from './mail.interface';
import { MailModule } from './mail.module';
import { SmtpMailDriver } from './smtp-mail.driver';

describe('MailModule driver selection (6.2 AC1)', () => {
  const ENV_KEYS = [
    'MAIL_DRIVER',
    'SMTP_HOST',
    'SMTP_PORT',
    'MAIL_FROM_ADDRESS',
    'MAIL_FROM_NAME',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const resolveDriver = async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        MailModule,
      ],
    }).compile();
    return moduleRef.get(MAIL_DRIVER);
  };

  it('defaults to the log driver for development', async () => {
    expect(await resolveDriver()).toBeInstanceOf(LogMailDriver);
  });

  it('selects the SMTP driver via MAIL_DRIVER=smtp', async () => {
    process.env.MAIL_DRIVER = 'smtp';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.MAIL_FROM_ADDRESS = 'no-reply@gxp.example';
    expect(await resolveDriver()).toBeInstanceOf(SmtpMailDriver);
  });
});
