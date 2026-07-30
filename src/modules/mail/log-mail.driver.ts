import { Logger } from '@nestjs/common';
import { MailDriver, MailMessage, REDACTION_MASK } from './mail.interface';

/**
 * Default driver for development (Story 6.2 AC1): the rendered email goes to
 * the app log only — the outbox row is the delivery record. Redact strings
 * (raw setup tokens) are masked so secrets never reach log storage.
 */
export class LogMailDriver implements MailDriver {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    let body = message.html;
    let subject = message.subject;
    for (const secret of message.redact ?? []) {
      body = body.split(secret).join(REDACTION_MASK);
      subject = subject.split(secret).join(REDACTION_MASK);
    }
    this.logger.log(
      `To: ${message.toName ? `${message.toName} <${message.to}>` : message.to}\n` +
        `Subject: ${subject}\n${body}`,
    );
  }
}
