import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { matchesAudience } from '../announcements/announcement-visibility';
import { AudienceFilter } from '../announcements/announcements.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { DispatchInput, PushDispatchService } from './push-dispatch.service';
import { quietHold } from './push-quiet-hours';
import { PUSH_REGISTRY } from './push-registry';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushType } from './push.constants';

export type PushTarget = { stayIds: string[] } | { audience: AudienceFilter };

export interface NotifyInput {
  refId: string | null;
  /** Per-occurrence idempotency: dedupeKey = `${dedupePrefix}:${subscription.id}`. */
  dedupePrefix?: string;
  /** True bypasses quiet hours (priority announcements, 23.3 AC4). */
  priority?: boolean;
  /** Type-specific compose vars; service injects slug/id-independent stay fields. */
  vars: Record<string, unknown>;
}

/**
 * THE emission API (23.1 AC5) — every business module that wants to push a
 * guest calls this ONE function. It resolves which stays to target (either
 * an explicit stay list or the same `matchesAudience` pure function the
 * Epic 19 announcements module uses, so audience semantics never drift
 * between the announcements UI's "recipient count" and what push actually
 * targets), looks up their devices, composes localized copy per-recipient
 * via `PUSH_REGISTRY`, applies quiet-hours holding, and hands the built
 * `DispatchInput[]` to `PushDispatchService.enqueueAndSend()`.
 *
 * Never throws (23.1 AC2/AC5) — the whole body is wrapped in one try/catch,
 * including the DB lookups and the quiet-hold computation, not just the
 * final dispatch call (mirrors the exception-safety discipline Task 5's
 * `attemptSend` needed): a push failure must never fail the caller's
 * business transition (an order status update, an announcement publish…).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    private readonly subscriptions: PushSubscriptionsService,
    private readonly dispatch: PushDispatchService,
    private readonly config: ConfigService,
  ) {}

  async notify(
    hotelId: string,
    target: PushTarget,
    type: PushType,
    input: NotifyInput,
  ): Promise<void> {
    try {
      const spec = PUSH_REGISTRY[type];
      const stays = await this.resolveStays(hotelId, target);
      if (!stays.length) return;

      const subs = await this.subscriptions.findByStayIds(stays.map((s) => s.id));
      if (!subs.length) return;

      const hotel = stays[0].hotel;
      const deliverAfter =
        spec.quietHours && !input.priority
          ? quietHold(
              hotel.timezone,
              new Date(),
              this.config.get('PUSH_QUIET_START', '22:00'),
              this.config.get('PUSH_QUIET_END', '08:00'),
            )
          : null;

      const byStay = new Map(stays.map((s) => [s.id, s]));
      const inputs: DispatchInput[] = [];
      for (const sub of subs) {
        const stay = byStay.get(sub.stayId);
        if (!stay) continue;
        const composed = spec.compose(stay.language, { slug: hotel.slug, ...input.vars });
        inputs.push({
          hotelId,
          stayId: stay.id,
          subscriptionId: sub.id,
          type,
          refId: input.refId,
          title: composed.title,
          body: composed.body,
          url: composed.url,
          ttlSeconds: spec.ttlSeconds,
          topic: input.refId ? spec.topic(input.refId) : null,
          dedupeKey: input.dedupePrefix ? `${input.dedupePrefix}:${sub.id}` : null,
          deliverAfter,
        });
      }

      await this.dispatch.enqueueAndSend(inputs);
    } catch (err) {
      this.logger.error(
        `push notify(${type}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Grouped sent/failed counts per refId — delegates straight to the dispatch outbox. */
  statsForRefs(refIds: string[]): Promise<Map<string, { sent: number; failed: number }>> {
    return this.dispatch.statsForRefs(refIds);
  }

  /**
   * 23.3 AC2 — audience path loads every active stay of the hotel (same
   * source `tenant-announcements.service.ts`'s `activeStays()` uses) and
   * filters in memory with `matchesAudience`, so the announcements UI's
   * recipient-count preview and what push actually targets never drift.
   * The stayIds path is scoped to the hotel + active status too — a
   * checked-out stay is never a valid push target even if its id is passed.
   */
  private async resolveStays(hotelId: string, target: PushTarget): Promise<Stay[]> {
    if ('stayIds' in target) {
      if (!target.stayIds.length) return [];
      return this.staysRepo.find({
        where: { id: In(target.stayIds), hotelId, status: 'active' },
        relations: ['hotel', 'room'],
      });
    }
    const all = await this.staysRepo.find({
      where: { hotelId, status: 'active' },
      relations: ['hotel', 'room'],
    });
    return all.filter((s) => matchesAudience(target.audience, s));
  }
}
