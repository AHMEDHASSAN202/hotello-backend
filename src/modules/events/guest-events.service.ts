import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { FnbPaymentMethod } from '../fnb/fnb.constants';
import { localizeField } from '../requests/requests.constants';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { Stay } from '../tenant-stays/stay.entity';
import { GuestLanguage, StayType } from '../tenant-stays/stays.constants';
import { BookEventDto } from './dto/book-event.dto';
import { ListGuestEventsQueryDto } from './dto/list-guest-events-query.dto';
import { EventBooking } from './event-booking.entity';
import { resolveEventPrice } from './event-pricing';
import { addMinutesLocal, hotelLocalStamp } from './event-time';
import { Event } from './event.entity';
import {
  EVENT_BOOKING_MAX_PARTY_SIZE,
  EventBookingCancelledBy,
  EventBookingStatus,
} from './events.constants';

/** Card shape for `GET /guest/events` (browse) — cheap, batch-loaded spots-left hint. */
export interface GuestEventCardView {
  id: string;
  title: string;
  photoThumbUrl: string | null;
  startAtLocal: string;
  endAtLocal: string | null;
  locationText: string;
  capacity: number | null;
  spotsLeft: number | null;
  soldOut: boolean;
  price: { included: boolean; unitPrice: number };
  currency: string;
}

/** `GET /guest/events/:id` — the card fields plus everything the booking sheet needs. */
export interface GuestEventDetailView extends GuestEventCardView {
  status: string;
  description: string;
  photoDetailUrl: string | null;
  maxPartySize: number;
  paymentMethods: FnbPaymentMethod[];
}

/** A guest's own booking — reads from the frozen `snapshot`, never the live event. */
export interface GuestEventBookingView {
  id: string;
  eventId: string;
  title: string;
  startAtLocal: string;
  endAtLocal: string | null;
  locationText: string;
  partySize: number;
  unitPrice: number;
  included: boolean;
  totalAmount: number;
  currency: string;
  paymentMethod: FnbPaymentMethod | null;
  status: EventBookingStatus;
  cancelledBy: EventBookingCancelledBy | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface GuestMyBookingsView {
  data: GuestEventBookingView[];
  todayBooking: GuestEventBookingView | null;
}

/**
 * Epic 21, Stories 21.4/21.5 — the guest side of Events & Workshops: browse
 * published upcoming events, book a spot (the capacity-race-safe write),
 * track own bookings, and self-cancel. Identity = session (stay from the
 * guest JWT, the F&B/Requests/Announcements precedent) — the server always
 * recomputes pricing (`resolveEventPrice`) and never trusts a client total.
 * Module/subscription gating happens here in the service, same manual
 * gating every guest service repeats — `TenantAccessGuard` no-ops on
 * `@GuestScope` routes (recorded decision, guest-fnb/guest-announcements
 * precedent). `cancelOwn` deliberately skips it (see that method's doc).
 */
@Injectable()
export class GuestEventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventsRepo: Repository<Event>,
    @InjectRepository(EventBooking)
    private readonly bookingsRepo: Repository<EventBooking>,
    private readonly dataSource: DataSource,
    private readonly access: TenantAccessService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ------------------------------------------------------------------
  // Browse (21.4)
  // ------------------------------------------------------------------

  async listUpcoming(
    stay: Stay,
    _query?: ListGuestEventsQueryDto,
  ): Promise<{ data: GuestEventCardView[] }> {
    await this.assertEventsAvailable(stay.hotelId);
    const nowLocal = hotelLocalStamp(stay.hotel.timezone, new Date());

    const events = await this.eventsRepo.find({
      where: {
        hotelId: stay.hotelId,
        status: 'published',
        startAtLocal: MoreThan(nowLocal),
      },
      order: { startAtLocal: 'ASC' },
    });
    if (events.length === 0) return { data: [] };

    const counts = await this.bookedPartySizes(events.map((e) => e.id));
    return {
      data: events.map((event) =>
        this.toCardView(event, stay, counts.get(event.id) ?? 0),
      ),
    };
  }

  /** 404 if cross-tenant, not found, or still `draft` — guests never see drafts. */
  async getDetail(stay: Stay, id: string): Promise<GuestEventDetailView> {
    await this.assertEventsAvailable(stay.hotelId);
    const event = await this.eventsRepo.findOne({
      where: { id, hotelId: stay.hotelId },
    });
    if (!event || event.status === 'draft') {
      throw new NotFoundException({
        code: 'EVENT_NOT_FOUND',
        message: 'Event not found',
      });
    }
    const bookedPartySize = await this.bookedPartySize(event.id);
    return this.toDetailView(event, stay, bookedPartySize);
  }

  // ------------------------------------------------------------------
  // Book (21.4) — the capacity-race-safe write
  // ------------------------------------------------------------------

  /**
   * The whole capacity guard lives inside ONE transaction: the event row is
   * locked `pessimistic_write` FIRST (scoped by `hotelId` in the same
   * query, so a cross-tenant id never even acquires a lock — the
   * `tenant-events.service.ts` `cancel()` precedent), and only THEN is the
   * booked-party-size SUM read and compared against capacity. Two
   * concurrent requests for the last spot serialize on the row lock: the
   * second transaction's SUM can only run after the first has committed
   * its INSERT, so it always sees the first booking's seats already
   * counted — real Postgres row-level serialization, not an
   * application-level check-then-act race.
   *
   * `now` is injectable (the `EventSchedulerService.transition()`
   * convention) so the hotel-local booking window is testable without
   * touching the process clock.
   */
  async book(
    stay: Stay,
    eventId: string,
    dto: BookEventDto,
    now: Date = new Date(),
  ): Promise<GuestEventBookingView> {
    await this.assertEventsAvailable(stay.hotelId);

    const booking = await this.dataSource.transaction(async (manager) => {
      const event = await manager.getRepository(Event).findOne({
        where: { id: eventId, hotelId: stay.hotelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event) {
        throw new NotFoundException({
          code: 'EVENT_NOT_FOUND',
          message: 'Event not found',
        });
      }
      if (event.status !== 'published') {
        throw new ConflictException({
          code: 'EVENT_NOT_BOOKABLE',
          message: 'This event is no longer open for booking',
        });
      }

      // Booking closes at the event's start — enforced HERE, on the hotel's
      // clock, because the client's "already started" guard runs on the
      // device clock and is not authoritative. Status alone is not enough:
      // the completion tick only flips `published → completed` at
      // endAtLocal (or start+3h), leaving a started event bookable in
      // between. Reuses EVENT_NOT_BOOKABLE — the frontends already translate
      // it and the guest-facing meaning ("you can't book this") is identical.
      const nowLocal = hotelLocalStamp(stay.hotel.timezone, now);
      if (nowLocal >= event.startAtLocal) {
        throw new ConflictException({
          code: 'EVENT_NOT_BOOKABLE',
          message: 'This event has already started',
        });
      }

      // Cheap, DB-free bounds first (defense-in-depth behind the DTO's own
      // @Min/@Max — this also covers direct service calls that skip the
      // ValidationPipe, e.g. this suite's unit tests).
      if (
        dto.partySize < 1 ||
        dto.partySize > EVENT_BOOKING_MAX_PARTY_SIZE
      ) {
        throw new BadRequestException({
          code: 'EVENT_PARTY_SIZE_INVALID',
          message: `Party size must be between 1 and ${EVENT_BOOKING_MAX_PARTY_SIZE}`,
        });
      }

      if (event.capacity != null) {
        const raw = await manager
          .getRepository(EventBooking)
          .createQueryBuilder('b')
          .select('COALESCE(SUM(b.partySize), 0)', 'sum')
          .where('b.eventId = :id', { id: event.id })
          .andWhere(`b.status = 'booked'`)
          .getRawOne<{ sum: string }>();
        const used = parseInt(raw?.sum ?? '0', 10);
        const remaining = event.capacity - used;
        if (dto.partySize > remaining) {
          throw new ConflictException({
            code: 'EVENT_SOLD_OUT',
            message: 'Not enough spots left for this event',
            capacity: event.capacity,
            used,
            remaining: Math.max(0, remaining),
          });
        }
      }

      const pricing = resolveEventPrice(
        event,
        stay.stayType as StayType,
        dto.partySize,
      );
      let paymentMethod: FnbPaymentMethod | null = null;
      if (!pricing.included) {
        if (dto.paymentMethod === 'room_charge' && !stay.hotel.roomChargeEnabled) {
          throw new BadRequestException({
            code: 'EVENT_PAYMENT_METHOD_UNAVAILABLE',
            message: 'Room charge is not available at this hotel',
          });
        }
        paymentMethod = dto.paymentMethod ?? 'cash';
      }

      const bookingsRepo = manager.getRepository(EventBooking);
      return bookingsRepo.save(
        bookingsRepo.create({
          hotelId: stay.hotelId,
          eventId: event.id,
          stayId: stay.id,
          partySize: dto.partySize,
          snapshot: {
            titles: event.titles,
            startAtLocal: event.startAtLocal,
            endAtLocal: event.endAtLocal,
            locationText: event.locationText,
          },
          unitPrice: pricing.unitPrice,
          included: pricing.included,
          totalAmount: pricing.total,
          // Same source as every other guest write (F&B `createOrder`,
          // `stay.hotel.currency` — never re-queried inside the tx).
          currency: stay.hotel.currency,
          paymentMethod,
          status: 'booked',
          cancelledBy: null,
          cancelledAt: null,
          cancelledReason: null,
          settledAt: null,
          settledById: null,
        }),
      );
    });

    // Audit AFTER commit — never inside the transaction (repo-wide rule,
    // `tenant-rooms.service.ts` `createRoom` precedent).
    await this.auditLogs.log({
      action: 'event_booking.created',
      entityType: 'event_booking',
      entityId: booking.id,
      actorId: null,
      metadata: {
        actorType: 'guest',
        hotelId: stay.hotelId,
        stayId: stay.id,
        eventId: booking.eventId,
        partySize: booking.partySize,
        totalAmount: booking.totalAmount,
        paymentMethod: booking.paymentMethod,
      },
    });

    return this.toBookingView(booking, stay.language);
  }

  // ------------------------------------------------------------------
  // My bookings & self-cancel (21.5)
  // ------------------------------------------------------------------

  async myBookings(
    stay: Stay,
    query: ListGuestEventsQueryDto,
  ): Promise<GuestMyBookingsView> {
    await this.assertEventsAvailable(stay.hotelId);
    const bookings = await this.bookingsRepo.find({
      where: { stayId: stay.id },
      order: { createdAt: 'DESC' },
    });
    const nowLocal = hotelLocalStamp(stay.hotel.timezone, new Date());
    const tab = query.tab ?? 'upcoming';

    const data = bookings
      .filter((b) => this.bookingTab(b, nowLocal) === tab)
      .map((b) => this.toBookingView(b, stay.language));

    // 21.5 AC1 — the home strip announces what's happening NEXT today, so
    // when a guest holds several bookings for the same day it must be the
    // earliest-STARTING one. `bookings` is ordered createdAt DESC (booking
    // order, unrelated to the programme), so sort the qualifying set by its
    // hotel-local start stamp — lexicographic ordering is chronological for
    // 'YYYY-MM-DD HH:MM'.
    const today = nowLocal.slice(0, 10);
    const todayBooking =
      bookings
        .filter(
          (b) =>
            b.status === 'booked' &&
            b.snapshot.startAtLocal.slice(0, 10) === today &&
            nowLocal <
              (b.snapshot.endAtLocal ??
                addMinutesLocal(b.snapshot.startAtLocal, 180)),
        )
        .sort((a, b) =>
          a.snapshot.startAtLocal < b.snapshot.startAtLocal ? -1 : 1,
        )[0] ?? null;

    return {
      data,
      todayBooking: todayBooking ? this.toBookingView(todayBooking, stay.language) : null,
    };
  }

  /**
   * Guest self-cancel — deliberately NO transaction/lock. Cancelling only
   * ever releases capacity (monotonic: `booked` → `cancelled`), it never
   * needs to check it against a live count the way `book()` does, so there
   * is nothing for a lock to protect here (the `EventBooking` row itself is
   * the only thing mutated, and a plain `save()` is enough).
   *
   * It also deliberately skips `assertEventsAvailable()` — the ruling:
   * self-cancel is a STATE-REDUCING operation (it releases capacity back to
   * the hotel and reduces the guest's own payment obligation), so it stays
   * available under subscription read-only and hotel suspension, where every
   * state-*adding* guest write (book) is locked out. Trapping a guest in a
   * booking they can't cancel — and in a room charge they'd still owe —
   * because the hotel's own subscription lapsed would punish the wrong
   * party. Module gating is skipped for the same reason: turning `events`
   * off must not strand existing bookings.
   */
  async cancelOwn(stay: Stay, id: string): Promise<GuestEventBookingView> {
    const booking = await this.bookingsRepo.findOne({
      where: { id, stayId: stay.id },
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'EVENT_BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }
    if (booking.status !== 'booked') {
      throw new ConflictException({
        code: 'EVENT_BOOKING_INVALID_STATUS',
        message: 'This booking can no longer be cancelled',
        status: booking.status,
      });
    }

    const nowLocal = hotelLocalStamp(stay.hotel.timezone, new Date());
    if (nowLocal >= booking.snapshot.startAtLocal) {
      throw new ConflictException({
        code: 'EVENT_BOOKING_PAST_START',
        message:
          'This event has already started — please check with the front desk',
      });
    }

    booking.status = 'cancelled';
    booking.cancelledBy = 'guest';
    booking.cancelledAt = new Date();
    booking.cancelledReason = null;
    const saved = await this.bookingsRepo.save(booking);

    await this.auditLogs.log({
      action: 'event_booking.cancelled',
      entityType: 'event_booking',
      entityId: saved.id,
      actorId: null,
      metadata: {
        actorType: 'guest',
        hotelId: stay.hotelId,
        stayId: stay.id,
        eventId: saved.eventId,
        reason: 'guest',
      },
    });

    return this.toBookingView(saved, stay.language);
  }

  // ------------------------------------------------------------------
  // Shared internals
  // ------------------------------------------------------------------

  /** Same manual gating as every guest service — guards no-op on @GuestScope. */
  private async assertEventsAvailable(hotelId: string): Promise<void> {
    const state = await this.access.getAccessState(hotelId);
    if (state.hotelStatus === 'suspended' || state.readOnly) {
      throw new ForbiddenException({
        code: 'HOTEL_UNAVAILABLE',
        message: 'This hotel is currently unavailable',
      });
    }
    if (!state.enabledModules.includes('events')) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: 'This module is not included in your plan',
        module: 'events',
      });
    }
  }

  /** One grouped query for a page/detail — never N+1 (the F&B/Task 4 `toListViews` rule). */
  private async bookedPartySizes(eventIds: string[]): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.bookingsRepo
      .createQueryBuilder('b')
      .select('b.eventId', 'eventId')
      .addSelect('COALESCE(SUM(b.partySize), 0)', 'total')
      .where('b.eventId IN (:...eventIds)', { eventIds })
      .andWhere(`b.status = 'booked'`)
      .groupBy('b.eventId')
      .getRawMany<{ eventId: string; total: string }>();
    return new Map(rows.map((row) => [row.eventId, parseInt(row.total, 10)]));
  }

  private async bookedPartySize(eventId: string): Promise<number> {
    const map = await this.bookedPartySizes([eventId]);
    return map.get(eventId) ?? 0;
  }

  private bookingTab(
    booking: EventBooking,
    nowLocal: string,
  ): 'upcoming' | 'past' | 'cancelled' {
    if (booking.status === 'cancelled') return 'cancelled';
    const threshold =
      booking.snapshot.endAtLocal ?? addMinutesLocal(booking.snapshot.startAtLocal, 180);
    return nowLocal < threshold ? 'upcoming' : 'past';
  }

  private toCardView(
    event: Event,
    stay: Stay,
    bookedPartySize: number,
  ): GuestEventCardView {
    // Clamped at 0: a staff capacity edit (or any future path that lands
    // bookings above capacity) must never render as "-2 spots left", and
    // anything at or below zero reads as sold out — the guest-visible
    // defense behind the tenant-side safe-edit rule.
    const remaining =
      event.capacity == null ? null : event.capacity - bookedPartySize;
    const spotsLeft = remaining == null ? null : Math.max(0, remaining);
    const price = resolveEventPrice(event, stay.stayType as StayType, 1);
    return {
      id: event.id,
      title: localizeField(event.titles, stay.language),
      photoThumbUrl: event.photoKeys ? `files/${event.photoKeys.thumb}` : null,
      startAtLocal: event.startAtLocal,
      endAtLocal: event.endAtLocal,
      locationText: event.locationText,
      capacity: event.capacity,
      spotsLeft,
      soldOut: spotsLeft !== null && spotsLeft <= 0,
      price: { included: price.included, unitPrice: price.unitPrice },
      currency: stay.hotel.currency,
    };
  }

  private toDetailView(
    event: Event,
    stay: Stay,
    bookedPartySize: number,
  ): GuestEventDetailView {
    return {
      ...this.toCardView(event, stay, bookedPartySize),
      status: event.status,
      description: localizeField(event.descriptions, stay.language),
      photoDetailUrl: event.photoKeys ? `files/${event.photoKeys.detail}` : null,
      maxPartySize: EVENT_BOOKING_MAX_PARTY_SIZE,
      paymentMethods: stay.hotel.roomChargeEnabled ? ['cash', 'room_charge'] : ['cash'],
    };
  }

  private toBookingView(
    booking: EventBooking,
    language: GuestLanguage,
  ): GuestEventBookingView {
    return {
      id: booking.id,
      eventId: booking.eventId,
      title: localizeField(booking.snapshot.titles, language),
      startAtLocal: booking.snapshot.startAtLocal,
      endAtLocal: booking.snapshot.endAtLocal,
      locationText: booking.snapshot.locationText,
      partySize: booking.partySize,
      unitPrice: booking.unitPrice,
      included: booking.included,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      paymentMethod: booking.paymentMethod,
      status: booking.status,
      cancelledBy: booking.cancelledBy,
      cancelledAt: booking.cancelledAt,
      createdAt: booking.createdAt,
    };
  }
}
