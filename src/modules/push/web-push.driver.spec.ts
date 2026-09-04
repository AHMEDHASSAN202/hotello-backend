import { WebPushDriver } from './web-push.driver';
import { PushSendError } from './push.interface';
import * as webpush from 'web-push';

jest.mock('web-push');

describe('WebPushDriver (23.1)', () => {
  const opts = { publicKey: 'p', privateKey: 's', subject: 'mailto:ops@gxp.app' };

  it('maps subscription + TTL/topic onto web-push sendNotification', async () => {
    (webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });
    const driver = new WebPushDriver(opts);
    await driver.send({
      endpoint: 'e', p256dh: 'k', auth: 'a',
      payload: '{"title":"T"}', ttlSeconds: 900, topic: 'abc123',
    });
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'e', keys: { p256dh: 'k', auth: 'a' } },
      '{"title":"T"}',
      expect.objectContaining({ TTL: 900, topic: 'abc123' }),
    );
  });

  it('wraps a 410 into PushSendError with gone=true', async () => {
    (webpush.sendNotification as jest.Mock).mockRejectedValue(
      Object.assign(new Error('gone'), { statusCode: 410 }),
    );
    const driver = new WebPushDriver(opts);
    const err = await driver.send({
      endpoint: 'e', p256dh: 'k', auth: 'a', payload: '{}', ttlSeconds: 60,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PushSendError);
    expect(err.gone).toBe(true);
  });
});
