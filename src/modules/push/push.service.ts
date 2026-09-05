import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { matchesAudience } from '../announcements/announcement-visibility';
import { AudienceFilter } from '../announcements/announcements.constants';
import { WILDCARD } from '../roles/permissions.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { DispatchInput, PushDispatchService } from './push-dispatch.service';
import { quietHold } from './push-quiet-hours';
import { PUSH_REGISTRY, PushTypeSpec } from './push-registry';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushType } from './push.constants';

export type PushTarget =
  | { stayIds: string[] }
  | { audience: AudienceFilter }
  /** Epic 26 — explicit staff recipients (assignment pushes). */
  | { tenantUserIds: string[] }
  /** Epic 26 — every active holder of a tenant permission (or `*`), minus the actor and muted users. */
  | { tenantPermission: string; excludeUserId?: string | null; mutedHintKey?: string };

/**
 * Mirrors `NotificationsService.resolveLanguage`'s order (user preference →
 * hotel default) — `GuestLanguage` includes both `'ar'` and `'en'`, so the
 * registry's `compose(language: GuestLanguage, …)` signature holds unchanged.
 */
const staffLanguage = (u: TenantUser): 'ar' | 'en' =>
  (u.preferredLanguage ?? u.hotel.defaultLanguage) === 'en' ? 'en' : 'ar';

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
    @InjectRepository(TenantUser) private readonly usersRepo: Repository<TenantUser>,
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
      if ('tenantUserIds' in target || 'tenantPermission' in target) {
        await this.notifyTenantUsers(hotelId, target, type, input, PUSH_REGISTRY[type]);
        return;
      }

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
        const stay = sub.stayId ? byStay.get(sub.stayId) : undefined;
        if (!stay) continue;
        const composed = spec.compose(stay.language, { slug: hotel.slug, ...input.vars });
        inputs.push({
          hotelId,
          stayId: stay.id,
          tenantUserId: null,
          subscriptionId: sub.id,
          type,
          refId: input.refId,
          title: composed.title,
          body: composed.body,
          url: composed.url,
          ttlSeconds: spec.ttlSeconds,
          topic: spec.topic(input.refId, input.vars),
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
   *
   * Only called for the guest-facing target shapes — `notify()` returns
   * early for the tenant-user shapes before reaching this.
   */
  private async resolveStays(
    hotelId: string,
    target: { stayIds: string[] } | { audience: AudienceFilter },
  ): Promise<Stay[]> {
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

  /** 26.4 AC2/AC3 — staff fan-out: per-user language, no quiet hours (shifts are the quiet hours). */
  private async notifyTenantUsers(
    hotelId: string,
    target: { tenantUserIds: string[] } | { tenantPermission: string; excludeUserId?: string | null; mutedHintKey?: string },
    type: PushType,
    input: NotifyInput,
    spec: PushTypeSpec,
  ): Promise<void> {
    const users = await this.resolveTenantUsers(hotelId, target);
    if (!users.length) return;
    const subs = await this.subscriptions.findByTenantUserIds(users.map((u) => u.id));
    if (!subs.length) return;
    const byUser = new Map(users.map((u) => [u.id, u]));
    const inputs: DispatchInput[] = [];
    for (const sub of subs) {
      const user = sub.tenantUserId ? byUser.get(sub.tenantUserId) : undefined;
      if (!user) continue;
      const composed = spec.compose(staffLanguage(user), { slug: user.hotel.slug, ...input.vars });
      inputs.push({
        hotelId,
        stayId: null,
        tenantUserId: user.id,
        subscriptionId: sub.id,
        type,
        refId: input.refId,
        title: composed.title,
        body: composed.body,
        url: composed.url,
        ttlSeconds: spec.ttlSeconds,
        topic: spec.topic(input.refId, input.vars),
        dedupeKey: input.dedupePrefix ? `${input.dedupePrefix}:${sub.id}` : null,
        deliverAfter: null,
      });
    }
    await this.dispatch.enqueueAndSend(inputs);
  }

  /**
   * `tenantUserIds` is an explicit recipient list (assignment pushes);
   * `tenantPermission` fans out to every active holder of that permission
   * key (or the tenant wildcard), minus the actor and anyone who muted this
   * class of push via `mutedHintKey`.
   */
  private async resolveTenantUsers(
    hotelId: string,
    target: { tenantUserIds: string[] } | { tenantPermission: string; excludeUserId?: string | null; mutedHintKey?: string },
  ): Promise<TenantUser[]> {
    if ('tenantUserIds' in target) {
      if (!target.tenantUserIds.length) return [];
      return this.usersRepo.find({
        where: { id: In(target.tenantUserIds), hotelId, status: 'active' },
        relations: ['hotel'],
      });
    }
    const users = await this.usersRepo
      .createQueryBuilder('u')
      .innerJoinAndSelect('u.role', 'r')
      .innerJoinAndSelect('u.hotel', 'h')
      .where('u.hotelId = :hotelId', { hotelId })
      .andWhere(`u.status = 'active'`)
      .andWhere(`(r.permissions @> ARRAY[:perm]::text[] OR r.permissions @> ARRAY[:wildcard]::text[])`, {
        perm: target.tenantPermission,
        wildcard: WILDCARD,
      })
      .getMany();
    return users.filter(
      (u) => u.id !== target.excludeUserId && !(target.mutedHintKey && (u.dismissedHints ?? []).includes(target.mutedHintKey)),
    );
  }
}
