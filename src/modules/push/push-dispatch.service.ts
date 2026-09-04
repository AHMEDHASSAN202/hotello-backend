import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, LessThanOrEqual, QueryFailedError, Repository } from 'typeorm';
import { naiveUtc } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { PushDispatch } from './push-dispatch.entity';
import { PushSubscription } from './push-subscription.entity';
import { PUSH_DRIVER, PushDriver, PushSendError } from './push.interface';
import { PushType } from './push.constants';

const BATCH_SIZE = 50; // processDue: bounded poller batch
const SEND_CONCURRENCY = 8; // enqueueAndSend: bounded fan-out for immediate sends

export interface DispatchInput {
  hotelId: string;
  stayId: string;
  subscriptionId: string;
  type: PushType;
  refId: string | null;
  title: string;
  body: string;
  url: string;
  ttlSeconds: number;
  topic: string | null;
  dedupeKey: string | null;
  deliverAfter: Date | null;
}

/**
 * The push outbox (23.1 AC2/AC3) — mirrors the email outbox pattern in
 * notifications.service.ts (persist-first, grace window, 23505-swallow,
 * exponential backoff + terminal classification, bounded poller), adapted
 * to push's shape: a stay-validity gate on every send attempt, 410-pruning
 * of dead subscriptions, topic-based collapse/supersede, quiet-hold via
 * `deliverAfter`, bounded-concurrency fan-out, and 30-day retention pruning.
 */
@Injectable()
export class PushDispatchService {
  private readonly logger = new Logger(PushDispatchService.name);

  constructor(
    @InjectRepository(PushDispatch) private readonly repo: Repository<PushDispatch>,
    @InjectRepository(PushSubscription)
    private readonly subsRepo: Repository<PushSubscription>,
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    @Inject(PUSH_DRIVER) private readonly driver: PushDriver,
    private readonly config: ConfigService,
  ) {}

  /**
   * Persist every input row first (23.1 AC2), then fire the immediate
   * (non-held) ones with bounded concurrency. A newer push for the same
   * `(topic, subscriptionId)` supersedes any still-pending row for that
   * pair — the supersede runs BEFORE the new row is inserted, so the new
   * row (not yet 'pending' in the DB) can never supersede itself (23.4 AC3).
   * Never throws: a render/DB explosion here must not fail the caller's
   * business transition (e.g. an order status update).
   */
  async enqueueAndSend(inputs: DispatchInput[]): Promise<void> {
    try {
      const now = new Date();
      const saved: PushDispatch[] = [];
      for (const input of inputs) {
        if (input.topic) {
          await this.repo.update(
            { topic: input.topic, subscriptionId: input.subscriptionId, status: 'pending' },
            { status: 'superseded', nextAttemptAt: null },
          );
        }
        const row = this.repo.create({
          ...input,
          status: 'pending',
          attemptCount: 0,
          // Grace window (email-outbox pattern): the caller (this method)
          // dispatches the first attempt itself; the poller only rescues a
          // row whose first attempt never got recorded (process died
          // mid-send). A held row's nextAttemptAt IS its release time.
          nextAttemptAt: input.deliverAfter ?? new Date(now.getTime() + this.retryBaseMs()),
          lastError: null,
          attempts: [],
          sentAt: null,
        });
        try {
          saved.push(await this.repo.save(row));
        } catch (err) {
          if (!this.isUniqueViolation(err)) throw err; // dedupe hit → silent no-op
        }
      }
      const immediate = saved.filter((r) => !r.deliverAfter || r.deliverAfter <= now);
      for (let i = 0; i < immediate.length; i += SEND_CONCURRENCY) {
        await Promise.all(
          immediate.slice(i, i + SEND_CONCURRENCY).map((r) => this.attemptSend(r)),
        );
      }
    } catch (err) {
      this.logger.error(
        `push enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * One delivery attempt. Never throws. 23.1 AC3 — stay validity gates
   * EVERY attempt, including retries and released quiet-holds: a checked-out
   * stay (or a hotel that went suspended) must never receive a queued push,
   * even one that was already in-flight when checkout happened.
   */
  async attemptSend(row: PushDispatch): Promise<void> {
    if (row.status !== 'pending') return;

    const stay = await this.staysRepo.findOne({
      where: { id: row.stayId },
      relations: ['hotel'],
    });
    if (!stay || stay.status !== 'active' || !stay.hotel || stay.hotel.status !== 'active') {
      return this.recordFailure(row, new Error('STAY_INACTIVE'), { terminal: true });
    }

    const sub = await this.subsRepo.findOne({ where: { id: row.subscriptionId } });
    if (!sub) {
      return this.recordFailure(row, new Error('SUBSCRIPTION_PRUNED'), { terminal: true });
    }

    try {
      await this.driver.send({
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        payload: JSON.stringify({
          title: row.title,
          body: row.body,
          url: row.url,
          tag: row.topic ?? undefined,
        }),
        ttlSeconds: row.ttlSeconds,
        topic: row.topic ?? undefined,
      });
      await this.recordSuccess(row, sub);
    } catch (err) {
      if (err instanceof PushSendError && err.gone) {
        // 404/410 — the endpoint is dead; prune it so future notify() calls
        // stop targeting it, and terminal-fail this dispatch (AC3).
        await this.subsRepo.delete({ id: sub.id });
        return this.recordFailure(row, err, { terminal: true });
      }
      await this.recordFailure(row, err, { sub });
    }
  }

  /** Bounded poller: due pending rows, oldest first (23.1 AC2). */
  async processDue(): Promise<number> {
    const due = await this.repo.find({
      where: { status: 'pending', nextAttemptAt: LessThanOrEqual(new Date()) },
      order: { nextAttemptAt: 'ASC' },
      take: BATCH_SIZE,
    });
    for (const row of due) {
      await this.attemptSend(row);
    }
    return due.length;
  }

  /**
   * 30-day retention (spec note 2): delete terminal rows older than
   * PUSH_RETENTION_DAYS, keeping `pending` rows regardless of age.
   * `updatedAt` is a naive `@UpdateDateColumn` — a raw JS Date query param
   * is serialized as LOCAL wall time by the pg driver and skews the query
   * by the host's UTC offset (see stay-time.ts naiveUtc doc; previously hit
   * live in this codebase). MUST wrap the cutoff with naiveUtc().
   */
  async pruneOld(): Promise<number> {
    const days = Number(this.config.get('PUSH_RETENTION_DAYS', '30'));
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const res = await this.repo.delete({
      status: In(['sent', 'failed', 'superseded']),
      updatedAt: LessThan(naiveUtc(cutoff)),
    });
    return res.affected ?? 0;
  }

  /** Grouped sent/failed counts per refId — powers the announcement push-stats line. */
  async statsForRefs(refIds: string[]): Promise<Map<string, { sent: number; failed: number }>> {
    const result = new Map<string, { sent: number; failed: number }>();
    if (!refIds.length) return result;
    const rows: Array<{ refId: string; status: string; count: string }> = await this.repo
      .createQueryBuilder('d')
      .select('d.refId', 'refId')
      .addSelect('d.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('d.refId IN (:...refIds)', { refIds })
      .andWhere('d.status IN (:...statuses)', { statuses: ['sent', 'failed'] })
      .groupBy('d.refId')
      .addGroupBy('d.status')
      .getRawMany();
    for (const r of rows) {
      const entry = result.get(r.refId) ?? { sent: 0, failed: 0 };
      if (r.status === 'sent') entry.sent = Number(r.count);
      if (r.status === 'failed') entry.failed = Number(r.count);
      result.set(r.refId, entry);
    }
    return result;
  }

  private async recordSuccess(row: PushDispatch, sub: PushSubscription): Promise<void> {
    const now = new Date();
    row.status = 'sent';
    row.sentAt = now;
    row.attemptCount += 1;
    row.lastError = null;
    row.nextAttemptAt = null;
    row.attempts = [...(row.attempts ?? []), { at: now.toISOString(), ok: true, error: null }];
    await this.repo.save(row);
    sub.lastSuccessAt = now;
    sub.failureCount = 0;
    await this.subsRepo.save(sub);
  }

  private async recordFailure(
    row: PushDispatch,
    err: unknown,
    opts: { terminal?: boolean; sub?: PushSubscription } = {},
  ): Promise<void> {
    const now = new Date();
    const message = err instanceof Error ? err.message : String(err);
    row.attemptCount += 1;
    row.lastError = message;
    row.attempts = [...(row.attempts ?? []), { at: now.toISOString(), ok: false, error: message }];
    if (opts.terminal || row.attemptCount >= this.maxAttempts()) {
      row.status = 'failed';
      row.nextAttemptAt = null;
    } else {
      // Exponential backoff: base, 2×base, 4×base…
      row.nextAttemptAt = new Date(now.getTime() + this.retryBaseMs() * 2 ** (row.attemptCount - 1));
      if (opts.sub) {
        opts.sub.failureCount += 1;
        await this.subsRepo.save(opts.sub);
      }
    }
    await this.repo.save(row);
    this.logger.warn(
      `Push dispatch ${row.id} (${row.type}) attempt ${row.attemptCount} failed: ${message}`,
    );
  }

  private maxAttempts(): number {
    return parseInt(this.config.get('PUSH_MAX_ATTEMPTS', '3'), 10);
  }

  private retryBaseMs(): number {
    return parseInt(this.config.get('PUSH_RETRY_BASE_MS', '60000'), 10);
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError &&
      (err.driverError as { code?: string } | undefined)?.code === '23505'
    );
  }
}
