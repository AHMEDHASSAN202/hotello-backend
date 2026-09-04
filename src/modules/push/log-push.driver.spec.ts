import { LogPushDriver } from './log-push.driver';

describe('LogPushDriver (23.1)', () => {
  it('logs endpoint + payload without throwing', async () => {
    const driver = new LogPushDriver();
    await expect(
      driver.send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        p256dh: 'k',
        auth: 'a',
        payload: JSON.stringify({ title: 'T', body: 'B', url: '/x' }),
        ttlSeconds: 60,
      }),
    ).resolves.toBeUndefined();
  });
});
