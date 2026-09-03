import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  SettlementSource,
  UnsettledLine,
  UnsettledStayLine,
} from '../stay-settlement/settlement-source.interface';
import { FnbOrderStatus } from './fnb.constants';
import { FnbOrder } from './fnb-order.entity';

/**
 * Story 21.6 AC2 — the ONE implementation of "which fnb orders are
 * unsettled for a stay" / "mark these settled": delivered, room-charge,
 * not yet settled (16.8 AC1/AC2). `TenantFnbOrdersService` delegates its
 * `unsettledTotal`/`settleStayOrders` internals here instead of keeping a
 * second copy, and `StaySettlementService` plugs this straight into the
 * combined checkout total via the shared `SettlementSource` interface — one
 * query/mutation, two consumers, never a fork.
 */
@Injectable()
export class FnbSettlementSource implements SettlementSource {
  readonly key = 'fnb';

  constructor(
    @InjectRepository(FnbOrder)
    private readonly ordersRepo: Repository<FnbOrder>,
  ) {}

  /**
   * Fetches every order on the stay (any status) and filters in memory —
   * the same shape `stayOrders()`'s pre-refactor `unsettledTotal(orders)`
   * helper used, reused here so the "remaining total" after a settle() call
   * reads consistently with the stay's already-loaded order list elsewhere.
   */
  async findUnsettled(hotelId: string, stayId: string): Promise<UnsettledLine[]> {
    const orders = await this.ordersRepo.find({ where: { hotelId, stayId } });
    return orders.filter((o) => this.isEligible(o)).map((o) => this.toLine(o));
  }

  /**
   * `orderIds` is an fnb-only extra, not part of the shared `SettlementSource`
   * signature (it's optional, so this still satisfies the interface): the
   * old `POST tenant/fnb-orders/stay/:id/settle` route lets staff settle a
   * subset of orders. The combined stay-settlement checkout flow always
   * settles everything, i.e. calls this with no ids — exactly what the
   * interface signature promises.
   */
  async markSettled(
    hotelId: string,
    stayId: string,
    settledById: string,
    orderIds?: string[],
  ): Promise<UnsettledLine[]> {
    const where: Record<string, unknown> = {
      hotelId,
      stayId,
      status: 'delivered' as FnbOrderStatus,
      paymentMethod: 'room_charge',
      settledAt: IsNull(),
    };
    if (orderIds?.length) where.id = In(orderIds);

    const toSettle = await this.ordersRepo.find({ where });
    if (toSettle.length === 0) return [];

    const now = new Date();
    for (const order of toSettle) {
      order.settledAt = now;
      order.settledById = settledById;
    }
    await this.ordersRepo.save(toSettle);
    return toSettle.map((o) => this.toLine(o));
  }

  /**
   * Bulk/hotel-wide counterpart to `findUnsettled`, used by report tasks
   * that need every unsettled line across many stays in one query rather
   * than one `findUnsettled` call per stay. Same eligibility rule
   * (`isEligible`), reused rather than duplicated.
   */
  async findUnsettledByStay(
    hotelId: string,
    stayIds?: string[],
  ): Promise<Map<string, UnsettledStayLine[]>> {
    const where: Record<string, unknown> = { hotelId };
    if (stayIds) where.stayId = In(stayIds);
    const orders = await this.ordersRepo.find({ where });

    const map = new Map<string, UnsettledStayLine[]>();
    for (const order of orders) {
      if (!this.isEligible(order)) continue;
      const line: UnsettledStayLine = {
        id: order.id,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
      };
      const lines = map.get(order.stayId);
      if (lines) lines.push(line);
      else map.set(order.stayId, [line]);
    }
    return map;
  }

  private isEligible(order: FnbOrder): boolean {
    return (
      order.status === 'delivered' &&
      order.paymentMethod === 'room_charge' &&
      !order.settledAt
    );
  }

  private toLine(order: FnbOrder): UnsettledLine {
    return { id: order.id, totalAmount: order.totalAmount };
  }
}
