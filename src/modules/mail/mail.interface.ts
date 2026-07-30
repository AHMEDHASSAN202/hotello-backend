/**
 * Email channel abstraction (Epic 06 Story 6.2). Mirrors the storage-driver
 * pattern: drivers are swapped via the MAIL_DRIVER env var without touching
 * callers. Adding `ses` or API-based providers means a new driver class only.
 */
export const MAIL_DRIVER = Symbol('MAIL_DRIVER');

/** Replacement for `redact` strings wherever a secret must not appear. */
export const REDACTION_MASK = '********';

export interface MailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  /**
   * Secrets (e.g. raw setup tokens) that must never appear in logs. Real
   * transports send `html` untouched; the log driver masks these strings.
   */
  redact?: string[];
}

export interface MailDriver {
  /** Throws on provider failure — the outbox captures it (Story 6.2 AC3). */
  send(message: MailMessage): Promise<void>;
}
