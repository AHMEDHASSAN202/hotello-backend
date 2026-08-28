import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { Stay } from './stay.entity';
import { isStayOverdue } from './stay-time';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 13.4 AC3 — automatic checkout. Runs hourly (not daily) because "midnight"
 * is hotel-local: each hotel closes when ITS clock passes `checkoutTime`,
 * regardless of server timezone. Idempotent — the query filters on
 * `status: 'active'`, so a re-run selects nothing already closed; extensions
 * (13.3 AC1) naturally rearm it by moving `checkOutDate` forward.
 *
 * Cron trigger only — the logic lives in `closeOverdueStays` so it stays
 * unit-testable (TrialExpiryService pattern), with the re-entrancy flag from
 * NotificationRetryService since @nestjs/schedule doesn't serialize runs.
 */
@Injectable()
export class AutoCheckoutService {
  private readonly logger = new Logger(AutoCheckoutService.name);
  private running = false;

  constructor(
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    private readonly auditLogs: AuditLogsService,
    private readonly housekeeping: HousekeepingService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyAutoCheckout() {
    if (this.running) {
      this.logger.warn('Previous auto-checkout run still active — skipping tick');
      return;
    }
    this.running = true;
    try {
      const count = await this.closeOverdueStays();
      if (count > 0) this.logger.log(`Auto-checked out ${count} stay(s)`);
    } catch (err) {
      this.logger.error(
        `Auto-checkout run failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Candidates are pre-filtered in SQL to stays whose check-out date is at
   * most one UTC day ahead (covers every UTC offset), then judged precisely
   * against the hotel's local wall-clock.
   */
  async closeOverdueStays(now: Date = new Date()): Promise<number> {
    const horizon = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
    const candidates = await this.staysRepo.find({
      where: { status: 'active', checkOutDate: LessThanOrEqual(horizon) },
      relations: ['hotel', 'room'],
    });

    let closed = 0;
    for (const stay of candidates) {
      const due = isStayOverdue(
        stay.checkOutDate,
        stay.hotel.checkoutTime,
        stay.hotel.timezone,
        now,
      );
      if (!due) continue;

      stay.status = 'checked_out';
      stay.checkoutType = 'automatic';
      stay.checkedOutAt = now;
      stay.checkedOutById = null;
      await this.staysRepo.save(stay);
      // Epic 20, 20.1 AC3 — automatic checkouts flag the room too.
      await this.housekeeping.onRoomVacated(stay.roomId, stay.hotelId, null);
      await this.auditLogs.log({
        action: 'stay.checked_out',
        entityType: 'stay',
        entityId: stay.id,
        actorId: null,
        metadata: {
          hotelId: stay.hotelId,
          checkoutType: 'automatic',
          roomNumber: stay.room?.roomNumber ?? null,
          checkOutDate: stay.checkOutDate,
        },
      });
      closed += 1;
    }
    return closed;
  }
}
