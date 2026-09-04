import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { EventBooking } from '../events/event-booking.entity';
import { addMinutesLocal, hotelLocalStamp } from '../events/event-time';
import { Event } from '../events/event.entity';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { Hotel } from '../hotels/hotel.entity';
import { hotelLocalParts, minutesOf } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { PushService } from './push.service';

/**
 * 23.5 — the job-driven pushes. Idempotency is the dispatch dedupeKey
 * (strategy 1 of the repo's three — see the epic file's recorded decisions):
 * re-running a tick re-notifies, and the unique `dedupeKey` on the outbox
 * makes the repeat a no-op. There is no stamp column here — a fourth
 * idempotency strategy would be redundant with what `PushService.notify` /
 * `PushDispatchService` already guarantee.
 *
 * Follows the Epic 13/19/20/21 job shape: thin `@Cron` trigger with a
 * re-entrancy flag, delegating to a `now`-injected `run()` for testability.
 */
@Injectable()
export class PushRemindersService {
  private readonly logger = new Logger(PushRemindersService.name);
  private running = false;

  constructor(
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(Event)
    private readonly eventsRepo: Repository<Event>,
    @InjectRepository(EventBooking)
    private readonly bookingsRepo: Repository<EventBooking>,
    @InjectRepository(Stay)
    private readonly staysRepo: Repository<Stay>,
    @InjectRepository(FnbOrder)
    private readonly ordersRepo: Repository<FnbOrder>,
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleTick(): Promise<void> {
    if (this.running) {
      this.logger.warn('PushRemindersService tick still active — skipping');
      return;
    }
    this.running = true;
    try {
      const result = await this.run();
      if (result.eventReminders > 0 || result.checkoutReminders > 0) {
        this.logger.log(
          `Sent ${result.eventReminders} event reminder(s), ${result.checkoutReminders} checkout reminder(s)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Push reminders tick failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }

  async run(
    now: Date = new Date(),
  ): Promise<{ eventReminders: number; checkoutReminders: number }> {
    const hotels = await this.hotelsRepo.find({ where: { status: Not('suspended') } });
    let eventReminders = 0;
    let checkoutReminders = 0;
    for (const hotel of hotels) {
      eventReminders += await this.eventReminders(hotel, now);
      checkoutReminders += await this.checkoutReminders(hotel, now);
    }
    return { eventReminders, checkoutReminders };
  }

  /** 23.5 AC1 — booked guests, ~60 hotel-local minutes before event start. */
  private async eventReminders(hotel: Hotel, now: Date): Promise<number> {
    const nowLocal = hotelLocalStamp(hotel.timezone, now);
    const horizon = addMinutesLocal(nowLocal, 60);
    const events = await this.eventsRepo.find({
      where: { hotelId: hotel.id, status: 'published' },
    });
    const due = events.filter(
      (e) => e.startAtLocal > nowLocal && e.startAtLocal <= horizon,
    );

    let count = 0;
    for (const event of due) {
      const bookings = await this.bookingsRepo.find({
        where: { eventId: event.id, status: 'booked' },
      });
      for (const booking of bookings) {
        await this.push.notify(hotel.id, { stayIds: [booking.stayId] }, 'event_reminder', {
          refId: booking.id,
          dedupePrefix: `event_reminder:${booking.id}`, // 23.5 AC1 — idempotent per booking
          vars: {
            id: event.id,
            titles: event.titles,
            startTime: event.startAtLocal.slice(11), // 'HH:MM'
            locationText: event.locationText ?? null,
          },
        });
        count++;
      }
    }
    return count;
  }

  /** 23.5 AC2 — departing guests, at/after the configured hotel-local hour. */
  private async checkoutReminders(hotel: Hotel, now: Date): Promise<number> {
    const { date, minutes } = hotelLocalParts(hotel.timezone, now);
    const at = minutesOf(this.config.get('PUSH_CHECKOUT_REMINDER_TIME', '08:30'));
    if (minutes < at) return 0;

    const departing = await this.staysRepo.find({
      where: { hotelId: hotel.id, status: 'active', checkOutDate: date },
    });

    let count = 0;
    for (const stay of departing) {
      // The balance line only when a room-charge order is unsettled (Epic 16.8 fields).
      const unsettled = await this.ordersRepo.count({
        where: {
          stayId: stay.id,
          paymentMethod: 'room_charge',
          status: 'delivered',
          settledAt: IsNull(),
        },
      });
      await this.push.notify(hotel.id, { stayIds: [stay.id] }, 'checkout_reminder', {
        refId: stay.id,
        dedupePrefix: `checkout_reminder:${stay.id}`, // 23.5 AC2 — once per stay
        vars: { checkoutTime: hotel.checkoutTime, hasUnsettledBalance: unsettled > 0 },
      });
      count++;
    }
    return count;
  }
}
