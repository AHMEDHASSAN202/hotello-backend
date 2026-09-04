import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Stay } from '../tenant-stays/stay.entity';
import { SubscribePushDto } from './dto/push.dto';
import { PushSubscription } from './push-subscription.entity';

/**
 * Guest device push subscriptions (Epic 23, Stories 23.1/23.2).
 *
 * `endpoint` is the natural key (unique index on the entity) — a given
 * browser/device push endpoint always maps to exactly one row. Subscribing
 * again from the same device is idempotent; subscribing from a *different*
 * stay re-binds the row to that stay (23.2 AC4 — e.g. a new guest checks
 * into a room and reuses a kiosk/shared device).
 */
@Injectable()
export class PushSubscriptionsService {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly repo: Repository<PushSubscription>,
  ) {}

  /** Idempotent per endpoint (23.1 AC1); a new stay on the same device re-binds (23.2 AC4). */
  async upsert(stay: Stay, dto: SubscribePushDto): Promise<void> {
    const existing = await this.repo.findOne({
      where: { endpoint: dto.endpoint },
    });
    const row = existing ?? this.repo.create({ endpoint: dto.endpoint });
    row.hotelId = stay.hotelId;
    row.stayId = stay.id;
    row.p256dh = dto.keys.p256dh;
    row.auth = dto.keys.auth;
    row.deviceHint = dto.deviceHint ?? row.deviceHint ?? null;
    row.failureCount = 0;
    await this.repo.save(row);
  }

  /**
   * Scoped to the caller's own stay — an endpoint that belongs to another
   * stay is never touched, even if the client sends it (tenant/guest
   * isolation: the criteria always includes `stayId`, not just `endpoint`).
   */
  async remove(stay: Stay, endpoint: string): Promise<void> {
    await this.repo.delete({ endpoint, stayId: stay.id });
  }

  async findByStayIds(stayIds: string[]): Promise<PushSubscription[]> {
    if (!stayIds.length) return [];
    return this.repo.find({ where: { stayId: In(stayIds) } });
  }
}
