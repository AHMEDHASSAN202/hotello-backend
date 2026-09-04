import * as webpush from 'web-push';
import { PushDriver, PushMessage, PushSendError } from './push.interface';

export interface WebPushOptions {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** PUSH_DRIVER=webpush — real VAPID sends; payload encryption handled by the lib. */
export class WebPushDriver implements PushDriver {
  constructor(private readonly opts: WebPushOptions) {}

  async send(message: PushMessage): Promise<void> {
    try {
      await webpush.sendNotification(
        {
          endpoint: message.endpoint,
          keys: { p256dh: message.p256dh, auth: message.auth },
        },
        message.payload,
        {
          TTL: message.ttlSeconds,
          ...(message.topic ? { topic: message.topic } : {}),
          ...(message.urgency ? { urgency: message.urgency } : {}),
          vapidDetails: {
            subject: this.opts.subject,
            publicKey: this.opts.publicKey,
            privateKey: this.opts.privateKey,
          },
        },
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      throw new PushSendError(
        err instanceof Error ? err.message : String(err),
        statusCode,
      );
    }
  }
}
