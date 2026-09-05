import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { PushService } from '../push/push.service';
import { Room } from '../tenant-rooms/room.entity';
import { hotelLocalParts, minutesOf } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { HousekeepingEventsService } from './housekeeping-events.service';
import { transition } from './housekeeping-transitions';

/**
 * Epic 20, 20.1 AC4 + 20.4 AC3 — the daily service tick. Once the hotel's
 * local clock passes `dailyServiceTime`:
 *
 * 1. occupied `clean` rooms flag `needs_cleaning (daily)` — skipping rooms
 *    currently dnd, already flagged, or in_progress;
 * 2. DND releases in the same tick — and a released room that lands on
 *    `clean` while occupied is immediately daily-flagged: the DND day was
 *    its skipped day, and "سيُعاد التنظيف غدًا تلقائيًا" promises the next
 *    service day happens normally (20.4 AC3).
 *
 * Idempotency is the per-room `lastDailyFlaggedOn` hotel-local date (note 4):
 * a re-run the same local day selects nothing. `setDnd(on)` stamps the same
 * date, so a DND switched on at any point today — before or after the tick —
 * survives every tick until tomorrow's service hour (the guest opted out of
 * today's service; recorded decision). 5-minute cadence (announcements
 * precedent) keeps the board within minutes of the configured hour across
 * timezones.
 */
@Injectable()
export class HousekeepingSchedulerService {
  private readonly logger = new Logger(HousekeepingSchedulerService.name);
  private running = false;

  constructor(
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
    @InjectRepository(Stay)
    private readonly staysRepo: Repository<Stay>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly auditLogs: AuditLogsService,
    private readonly housekeepingEvents: HousekeepingEventsService,
    private readonly push: PushService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleTick(): Promise<void> {
    if (this.running) {
      this.logger.warn('daily service run still active — skipping tick');
      return;
    }
    this.running = true;
    try {
      const { flagged, released } = await this.runDailyService();
      if (flagged || released) {
        this.logger.log(
          `daily service: ${flagged} room(s) flagged, ${released} DND release(s)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `daily service run failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Injectable clock for tests; returns work done for the tick log line. */
  async runDailyService(
    now: Date = new Date(),
  ): Promise<{ flagged: number; released: number }> {
    const hotels = await this.hotelsRepo.find({
      where: { status: Not('suspended') },
    });
    let flagged = 0;
    let released = 0;
    for (const hotel of hotels) {
      const local = hotelLocalParts(hotel.timezone, now);
      if (local.minutes < minutesOf(hotel.dailyServiceTime)) continue;
      const counts = await this.processHotel(hotel, local.date);
      flagged += counts.flagged;
      released += counts.released;
      if (counts.flagged > 0) {
        await this.notifyStaffAvailableSafely(hotel.id, local.date, counts.flagged);
      }
    }
    return { flagged, released };
  }

  /**
   * 26.4 AC2 ③ — one push per hotel per tick (not per room): the
   * `staff_daily:{hotelId}:{localDate}` dedupe prefix makes the 5-minute
   * cadence idempotent, matching `lastDailyFlaggedOn`'s per-room idempotency
   * (note 4). `PushService.notify` never throws (Task 6's guarantee), but
   * this try/catch is defense in depth — a push failure must never fail the
   * tick itself.
   */
  private async notifyStaffAvailableSafely(
    hotelId: string,
    localDate: string,
    count: number,
  ): Promise<void> {
    try {
      await this.push.notify(
        hotelId,
        { tenantPermission: 'housekeeping.update', mutedHintKey: 'staffPush.availableMuted' },
        'staff_available',
        {
          refId: null,
          dedupePrefix: `staff_daily:${hotelId}:${localDate}`,
          vars: { feed: 'rooms', count },
        },
      );
    } catch (err) {
      this.logger.error(
        `push notify(staff_available) failed for hotel ${hotelId} daily tick: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async processHotel(
    hotel: Hotel,
    localDate: string,
  ): Promise<{ flagged: number; released: number }> {
    let flagged = 0;
    let released = 0;

    const activeStays = await this.staysRepo.find({
      where: { hotelId: hotel.id, status: 'active' },
      select: ['roomId'],
    });
    const occupiedRoomIds = new Set(activeStays.map((s) => s.roomId));

    // 20.4 AC3 — release expired DND (set before today, hotel-local). A room
    // releasing to `clean` while occupied is daily-flagged right away — its
    // skipped day is over. A parked flag (20.4 AC2) is restored by dnd_off.
    const dndRooms = await this.roomsRepo.find({
      where: { hotelId: hotel.id, housekeepingStatus: 'dnd' },
    });
    for (const room of dndRooms) {
      if (room.lastDailyFlaggedOn === localDate) continue;
      const releasedState = transition(
        { status: room.housekeepingStatus, cleaningType: room.cleaningType },
        { type: 'dnd_off' },
      );
      if (!releasedState.ok) continue;
      let state = releasedState.state;
      const reFlagged = state.status === 'clean' && occupiedRoomIds.has(room.id);
      if (reFlagged) {
        const next = transition(state, { type: 'flag', cleaningType: 'daily' });
        if (next.ok) state = next.state;
      }
      room.housekeepingStatus = state.status;
      room.cleaningType = state.cleaningType;
      room.dndSetByStayId = null;
      room.lastDailyFlaggedOn = localDate;
      const saved = await this.roomsRepo.save(room);
      released += 1;
      if (reFlagged) flagged += 1;
      await this.auditLogs.log({
        action: 'housekeeping.dnd_cleared',
        entityType: 'room',
        entityId: saved.id,
        actorId: null,
        metadata: {
          actorType: 'system',
          hotelId: hotel.id,
          reason: 'daily_service_hour',
          reFlagged,
          housekeepingStatus: saved.housekeepingStatus,
        },
      });
      await this.housekeepingEvents.record({
        hotelId: hotel.id,
        roomId: saved.id,
        eventType: 'dnd_cleared',
        actorId: null,
      });
      if (reFlagged) {
        await this.housekeepingEvents.record({
          hotelId: hotel.id,
          roomId: saved.id,
          eventType: 'flagged',
          cleaningType: 'daily',
          actorId: null,
        });
      }
    }

    // 20.1 AC4 — flag occupied clean rooms for daily service. Rooms already
    // flagged, in progress or dnd are skipped by the status filter; inactive
    // and out_of_service rooms can't hold an active stay, so occupancy
    // already narrows to bookable rooms.
    if (occupiedRoomIds.size === 0) return { flagged, released };
    const candidates = await this.roomsRepo.find({
      where: {
        id: In([...occupiedRoomIds]),
        hotelId: hotel.id,
        housekeepingStatus: 'clean',
      },
    });
    for (const room of candidates) {
      if (room.lastDailyFlaggedOn === localDate) continue;
      const result = transition(
        { status: room.housekeepingStatus, cleaningType: room.cleaningType },
        { type: 'flag', cleaningType: 'daily' },
      );
      if (!result.ok) continue;
      room.housekeepingStatus = result.state.status;
      room.cleaningType = result.state.cleaningType;
      room.lastDailyFlaggedOn = localDate;
      const saved = await this.roomsRepo.save(room);
      flagged += 1;
      await this.auditLogs.log({
        action: 'housekeeping.flagged',
        entityType: 'room',
        entityId: saved.id,
        actorId: null,
        metadata: {
          actorType: 'system',
          hotelId: hotel.id,
          cleaningType: 'daily',
          reason: 'daily_service_hour',
          housekeepingStatus: saved.housekeepingStatus,
        },
      });
      await this.housekeepingEvents.record({
        hotelId: hotel.id,
        roomId: saved.id,
        eventType: 'flagged',
        cleaningType: 'daily',
        actorId: null,
      });
    }
    return { flagged, released };
  }
}
