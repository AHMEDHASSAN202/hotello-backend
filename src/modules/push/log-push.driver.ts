import { Logger } from '@nestjs/common';
import { PushDriver, PushMessage } from './push.interface';

/** PUSH_DRIVER=log — dev/test default; mirrors LogMailDriver. Keys are never logged. */
export class LogPushDriver implements PushDriver {
  private readonly logger = new Logger('PushDriver');

  async send(message: PushMessage): Promise<void> {
    this.logger.log(
      `[push] → ${message.endpoint.slice(0, 60)}… ttl=${message.ttlSeconds}` +
        `${message.topic ? ` topic=${message.topic}` : ''} ${message.payload}`,
    );
  }
}
