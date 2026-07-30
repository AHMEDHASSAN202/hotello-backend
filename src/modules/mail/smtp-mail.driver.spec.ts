import { SmtpMailDriver } from './smtp-mail.driver';

const sendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail })),
}));
import { createTransport } from 'nodemailer';

describe('SmtpMailDriver', () => {
  beforeEach(() => jest.clearAllMocks());

  const makeDriver = () =>
    new SmtpMailDriver({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'mailer',
      pass: 'secret',
      fromAddress: 'no-reply@gxp.example',
      fromName: 'GXP Platform',
    });

  describe('smtp transport (6.2 AC1/AC2)', () => {
    it('builds the transport from env-driven options', () => {
      makeDriver();
      expect(createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'mailer', pass: 'secret' },
      });
    });

    it('sends from the configurable platform identity (AC2)', async () => {
      await makeDriver().send({
        to: 'owner@nilegrand.example',
        toName: 'Owner One',
        subject: 'Hello',
        html: '<p>Hi</p>',
      });

      expect(sendMail).toHaveBeenCalledWith({
        from: '"GXP Platform" <no-reply@gxp.example>',
        to: '"Owner One" <owner@nilegrand.example>',
        subject: 'Hello',
        html: '<p>Hi</p>',
      });
    });

    it('propagates transport errors to the caller (captured by the outbox, AC3)', async () => {
      sendMail.mockRejectedValue(new Error('connection refused'));
      await expect(
        makeDriver().send({ to: 'a@b.c', subject: 's', html: '<p/>' }),
      ).rejects.toThrow('connection refused');
    });
  });
});
