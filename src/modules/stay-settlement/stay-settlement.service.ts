import { Inject, Injectable } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantStaysService } from '../tenant-stays/tenant-stays.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  SETTLEMENT_SOURCES,
  SettlementSource,
  UnsettledLine,
} from './settlement-source.interface';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const sumLines = (lines: UnsettledLine[]): number =>
  round2(lines.reduce((sum, line) => sum + line.totalAmount, 0));

export interface StayUnsettledView {
  total: number;
  /** Per-source subtotal, keyed by `SettlementSource.key` (the UI breakdown). */
  byKey: Record<string, number>;
}

export interface StayUnsettledSummary {
  total: number;
  byKey: Record<string, number>;
  oldestUnsettledAt: Date;
}

/**
 * Story 21.6 AC2 — the stay-checkout drawer's combined view: one unsettled
 * total and one settle action across every `SettlementSource` (today: F&B
 * room-charge orders + event-booking room-charge bookings). Never
 * re-implements either domain's eligibility rule — it only orchestrates the
 * sources behind the shared interface, so there is exactly one
 * implementation of "which fnb orders are unsettled" / "which event
 * bookings are unsettled", each owned by its own module.
 */
@Injectable()
export class StaySettlementService {
  constructor(
    @Inject(SETTLEMENT_SOURCES)
    private readonly sources: SettlementSource[],
    private readonly stays: TenantStaysService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async unsettledTotal(
    user: TenantUser,
    stayId: string,
  ): Promise<StayUnsettledView> {
    // Cross-tenant chokepoint: unknown/foreign stays 404 here, before any
    // source is queried.
    await this.stays.findStayInHotel(user.hotelId, stayId);

    const perSource = await Promise.all(
      this.sources.map((source) => source.findUnsettled(user.hotelId, stayId)),
    );

    const byKey: Record<string, number> = {};
    let total = 0;
    this.sources.forEach((source, i) => {
      const subtotal = sumLines(perSource[i]);
      byKey[source.key] = subtotal;
      total += subtotal;
    });

    return { total: round2(total), byKey };
  }

  async settle(
    user: TenantUser,
    stayId: string,
  ): Promise<{ settled: number; unsettledTotal: number }> {
    await this.stays.findStayInHotel(user.hotelId, stayId);

    const perSource = await Promise.all(
      this.sources.map((source) =>
        source.markSettled(user.hotelId, stayId, user.id),
      ),
    );

    const breakdown: Record<string, { count: number; total: number }> = {};
    let settled = 0;
    this.sources.forEach((source, i) => {
      const lines = perSource[i];
      breakdown[source.key] = { count: lines.length, total: sumLines(lines) };
      settled += lines.length;
    });

    // One audit entry per settle() call — never one per source, so the
    // combined checkout action reads as a single event in the log. Only
    // written when something actually moved (the legacy F&B
    // `settleStayOrders` behavior): a repeated/idempotent settle is a no-op,
    // not a log entry.
    if (settled > 0) {
      await this.auditLogs.log({
        action: 'stay_settlement.settled',
        entityType: 'stay',
        entityId: stayId,
        actorId: user.id,
        metadata: { actorType: 'tenant_user', hotelId: user.hotelId, breakdown },
      });
    }

    // Re-read every source instead of assuming zero: a charge placed while
    // the settle was in flight (guest orders room service as the front desk
    // clicks "settle") is NOT covered by the markSettled queries above and
    // must resurface on the drawer immediately — the same "remaining after
    // settle" contract the legacy F&B route returns.
    const remaining = await Promise.all(
      this.sources.map((source) => source.findUnsettled(user.hotelId, stayId)),
    );

    return {
      settled,
      unsettledTotal: round2(
        remaining.reduce((total, lines) => total + sumLines(lines), 0),
      ),
    };
  }

  /**
   * Hotel-wide counterpart to `unsettledTotal` — no single-stay chokepoint
   * (there is no "not found" concept for a bulk query), so this does NOT call
   * `findStayInHotel`. Every source's eligibility rule is exactly the one it
   * already owns (`findUnsettledByStay`) — nothing here re-implements that.
   */
  async unsettledByStay(
    hotelId: string,
    stayIds?: string[],
  ): Promise<Map<string, StayUnsettledSummary>> {
    const perSource = await Promise.all(
      this.sources.map((source) => source.findUnsettledByStay(hotelId, stayIds)),
    );

    const result = new Map<string, StayUnsettledSummary>();
    this.sources.forEach((source, i) => {
      const byStay = perSource[i];
      for (const [stayId, lines] of byStay) {
        if (lines.length === 0) continue;
        const subtotal = sumLines(lines);
        const oldest = lines.reduce(
          (min, line) => (line.createdAt < min ? line.createdAt : min),
          lines[0].createdAt,
        );
        const existing = result.get(stayId);
        if (existing) {
          existing.total = round2(existing.total + subtotal);
          existing.byKey[source.key] = subtotal;
          if (oldest < existing.oldestUnsettledAt) {
            existing.oldestUnsettledAt = oldest;
          }
        } else {
          result.set(stayId, {
            total: subtotal,
            byKey: { [source.key]: subtotal },
            oldestUnsettledAt: oldest,
          });
        }
      }
    });
    return result;
  }

  /** Thin wrapper — the set of stays with any unsettled balance in the hotel. */
  async unsettledStayIds(hotelId: string): Promise<Set<string>> {
    const byStay = await this.unsettledByStay(hotelId);
    return new Set(byStay.keys());
  }
}
