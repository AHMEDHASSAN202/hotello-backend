export const PUSH_DRIVER = Symbol('PUSH_DRIVER');

/** One Web Push send, fully composed — drivers never localize or build URLs. */
export interface PushMessage {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** JSON string `{ title, body, url, tag }` — the SW renders it verbatim. */
  payload: string;
  ttlSeconds: number;
  /** Web Push collapse topic (base64url, ≤32 chars) — latest wins on the device. */
  topic?: string;
  urgency?: 'normal' | 'high';
}

/** Thrown by drivers on provider failure; `gone` marks prunable endpoints. */
export class PushSendError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
  get gone(): boolean {
    return this.statusCode === 404 || this.statusCode === 410;
  }
}

export interface PushDriver {
  /** Throws PushSendError on provider failure — the outbox captures it (23.1 AC2). */
  send(message: PushMessage): Promise<void>;
}
