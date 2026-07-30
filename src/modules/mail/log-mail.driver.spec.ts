import { Logger } from '@nestjs/common';
import { LogMailDriver } from './log-mail.driver';

describe('LogMailDriver', () => {
  let driver: LogMailDriver;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    driver = new LogMailDriver();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => logSpy.mockRestore());

  describe('log driver masking (6.4 AC2)', () => {
    it('writes the rendered email to the log with every redact string masked', async () => {
      await driver.send({
        to: 'owner@nilegrand.example',
        toName: 'Owner One',
        subject: 'Activate your account',
        html: '<a href="https://x.example/setup?token=RAW-SECRET">Activate</a>',
        redact: ['RAW-SECRET'],
      });

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('owner@nilegrand.example');
      expect(output).toContain('Activate your account');
      expect(output).toContain('token=********');
      expect(output).not.toContain('RAW-SECRET');
    });

    it('sends untouched when there is nothing to redact', async () => {
      await driver.send({
        to: 'owner@nilegrand.example',
        subject: 'Trial reminder',
        html: '<p>7 days left</p>',
      });
      expect(logSpy.mock.calls[0][0]).toContain('7 days left');
    });
  });
});
