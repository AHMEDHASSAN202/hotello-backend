import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FnbPaymentMethod } from '../fnb/fnb.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { EventBooking } from './event-booking.entity';
import { EventBookingStatus } from './events.constants';
import { EventManageView, TenantEventsService } from './tenant-events.service';

export interface AttendeeBookingView {
  guestName: string;
  roomNumber: string;
  partySize: number;
  paymentMethod: FnbPaymentMethod | null;
  bookedAt: Date;
  status: EventBookingStatus;
}

export interface AttendeesView {
  event: EventManageView;
  bookings: AttendeeBookingView[];
  totals: {
    /** SUM(partySize) of `status='booked'` bookings — the F&B `bookedCounts` rule. */
    booked: number;
    capacity: number | null;
    expectedCash: number;
    expectedRoomCharge: number;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Story 21.6 AC1 — read-only attendee list + live totals for a single event.
 * `EventBooking` does NOT snapshot guest/room fields the way `FnbOrder` does
 * (no `guestName`/`roomNumber` columns) — its `snapshot` JSONB only freezes
 * the *event's* details at booking time. So guest name / room number are
 * resolved live here by batch-loading `Stay` with its `room` relation and
 * reading `stay.guestName` / `stay.room.roomNumber` — exactly the fields
 * `guest-fnb.service.ts` copies onto `FnbOrder` at order-creation time
 * (`roomNumber: stay.room.roomNumber, guestName: stay.guestName`), just read
 * on demand instead of persisted. Batch-loaded once for the whole list, the
 * F&B `toViews` never-N+1 rule.
 *
 * Totals semantics (documented for the controller/UI and future reviewers):
 * - `booked` sums `partySize` over `status='booked'` bookings only —
 *   cancelled bookings release their party size and never count.
 * - `expectedCash` / `expectedRoomCharge` split *active* (`status='booked'`)
 *   bookings by `paymentMethod`. `expectedRoomCharge` additionally excludes
 *   bookings that are already `settledAt` — once a room-charge booking is
 *   settled it has posted to the stay's folio at checkout (the F&B
 *   `unsettledTotal` precedent, Story 21.6 AC2), so counting it again here
 *   as "expected" would double it. Cash bookings have no settlement step
 *   (the F&B convention — cash is collected in person), so every booked
 *   cash booking stays "expected" until it's cancelled.
 */
@Injectable()
export class TenantEventAttendeesService {
  constructor(
    @InjectRepository(EventBooking)
    private readonly bookingsRepo: Repository<EventBooking>,
    @InjectRepository(Stay)
    private readonly staysRepo: Repository<Stay>,
    private readonly events: TenantEventsService,
  ) {}

  async list(user: TenantUser, eventId: string): Promise<AttendeesView> {
    // Cross-tenant chokepoint: unknown/foreign events 404 here.
    const event = await this.events.findEvent(user.hotelId, eventId);

    const bookings = await this.bookingsRepo.find({
      where: { eventId: event.id },
      order: { createdAt: 'DESC' },
    });

    const stayIds = [...new Set(bookings.map((b) => b.stayId))];
    const stays = stayIds.length
      ? await this.staysRepo.find({
          where: { id: In(stayIds) },
          relations: ['room'],
        })
      : [];
    const stayById = new Map(stays.map((s) => [s.id, s] as [string, Stay]));

    const bookingViews: AttendeeBookingView[] = bookings.map((booking) => {
      const stay = stayById.get(booking.stayId);
      return {
        guestName: stay?.guestName ?? '',
        roomNumber: stay?.room?.roomNumber ?? '',
        partySize: booking.partySize,
        paymentMethod: booking.paymentMethod,
        bookedAt: booking.createdAt,
        status: booking.status,
      };
    });

    const active = bookings.filter((b) => b.status === 'booked');
    const booked = active.reduce((sum, b) => sum + b.partySize, 0);
    const expectedCash = round2(
      active
        .filter((b) => b.paymentMethod === 'cash')
        .reduce((sum, b) => sum + b.totalAmount, 0),
    );
    const expectedRoomCharge = round2(
      active
        .filter((b) => b.paymentMethod === 'room_charge' && !b.settledAt)
        .reduce((sum, b) => sum + b.totalAmount, 0),
    );

    return {
      event: this.events.toManageView(event),
      bookings: bookingViews,
      totals: {
        booked,
        capacity: event.capacity,
        expectedCash,
        expectedRoomCharge,
      },
    };
  }
}
