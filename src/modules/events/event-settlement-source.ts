import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  SettlementSource,
  UnsettledLine,
  UnsettledStayLine,
} from '../stay-settlement/settlement-source.interface';
import { EventBooking } from './event-booking.entity';
import { fromNaive } from '../tenant-stays/stay-time';

/**
 * Story 21.6 AC2 — the events side of the shared settlement interface,
 * mirroring `FnbSettlementSource`'s eligibility rule one-for-one: an active
 * (`status='booked'`) booking, `paymentMethod='room_charge'`, not yet
 * settled. A cancelled booking is excluded even if it was room-charge and
 * never settled — the same exclusion Task 8's attendees totals apply
 * (`expectedRoomCharge` only counts `status='booked'` bookings).
 */
@Injectable()
export class EventSettlementSource implements SettlementSource {
  readonly key = 'events';

  constructor(
    @InjectRepository(EventBooking)
    private readonly bookingsRepo: Repository<EventBooking>,
  ) {}

  /**
   * Fetches every booking on the stay (any status) and filters in memory —
   * the same "batch-load then filter" shape Task 8's attendees totals use
   * (`expectedRoomCharge`), mirrored here so both settlement sources read
   * consistently.
   */
  async findUnsettled(hotelId: string, stayId: string): Promise<UnsettledLine[]> {
    const bookings = await this.bookingsRepo.find({ where: { hotelId, stayId } });
    return bookings
      .filter((b) => this.isEligible(b))
      .map((b) => this.toLine(b));
  }

  async markSettled(
    hotelId: string,
    stayId: string,
    settledById: string,
  ): Promise<UnsettledLine[]> {
    const toSettle = await this.bookingsRepo.find({
      where: {
        hotelId,
        stayId,
        status: 'booked',
        paymentMethod: 'room_charge',
        settledAt: IsNull(),
      },
    });
    if (toSettle.length === 0) return [];

    const now = new Date();
    for (const booking of toSettle) {
      booking.settledAt = now;
      booking.settledById = settledById;
    }
    await this.bookingsRepo.save(toSettle);
    return toSettle.map((b) => this.toLine(b));
  }

  /**
   * Bulk/hotel-wide counterpart to `findUnsettled`, mirroring
   * `FnbSettlementSource.findUnsettledByStay` — used by report tasks that
   * need every unsettled line across many stays in one query. Same
   * eligibility rule (`isEligible`), reused rather than duplicated.
   */
  async findUnsettledByStay(
    hotelId: string,
    stayIds?: string[],
  ): Promise<Map<string, UnsettledStayLine[]>> {
    const where: Record<string, unknown> = { hotelId };
    if (stayIds) where.stayId = In(stayIds);
    const bookings = await this.bookingsRepo.find({ where });

    const map = new Map<string, UnsettledStayLine[]>();
    for (const booking of bookings) {
      if (!this.isEligible(booking)) continue;
      const line: UnsettledStayLine = {
        id: booking.id,
        totalAmount: booking.totalAmount,
        // `createdAt` is a naive `timestamp` column (UTC wall time); pg
        // mis-parses it as host-local. fromNaive() recovers the true
        // instant (Epic 22 final review, C1) so downstream consumers
        // (StaySettlementService.oldestUnsettledAt, ReportsRevenueService
        // outstanding window) compare against the correct instant.
        createdAt: fromNaive(booking.createdAt),
      };
      const lines = map.get(booking.stayId);
      if (lines) lines.push(line);
      else map.set(booking.stayId, [line]);
    }
    return map;
  }

  private isEligible(booking: EventBooking): boolean {
    return (
      booking.status === 'booked' &&
      booking.paymentMethod === 'room_charge' &&
      !booking.settledAt
    );
  }

  private toLine(booking: EventBooking): UnsettledLine {
    return { id: booking.id, totalAmount: booking.totalAmount };
  }
}
