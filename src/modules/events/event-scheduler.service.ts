import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { addMinutesLocal, hotelLocalStamp } from './event-time';
import { Event } from './event.entity';

/**
 * Story 21.2 AC2 — the Epic 13/19/20 jobs pattern (thin cron trigger,
 * `now`-injected testable method, re-entrancy flag) at a 5-minute cadence.
 * Flips `published` events to `completed` once the hotel-local clock passes
 * `endAtLocal` — or, for endless events (`endAtLocal = null`), `startAtLocal`
 * + 3h (Task 4's default duration).
 *
 * Idempotent — the query filters on `status: 'published'`, so a re-run
 * selects nothing already flipped. `draft`/`cancelled` events are never
 * selected and so never touched.
 */
@Injectable()
export class EventSchedulerService {
  private readonly logger = new Logger(EventSchedulerService.name);
  private running = false;

  constructor(
    @InjectRepository(Event)
    private readonly eventsRepo: Repository<Event>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleTick(): Promise<void> {
    if (this.running) {
      this.logger.warn('EventSchedulerService tick still active — skipping');
      return;
    }
    this.running = true;
    try {
      const result = await this.transition();
      if (result.completed > 0) {
        this.logger.log(`Completed ${result.completed} event(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Event completion tick failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }

  async transition(now: Date = new Date()): Promise<{ completed: number }> {
    const candidates = await this.eventsRepo.find({
      where: { status: 'published' },
      relations: ['hotel'],
    });

    let completed = 0;
    for (const event of candidates) {
      const nowLocal = hotelLocalStamp(event.hotel.timezone, now);
      const threshold = event.endAtLocal ?? addMinutesLocal(event.startAtLocal, 180);
      if (nowLocal <= threshold) continue;

      event.status = 'completed';
      event.completedAt = now;
      await this.eventsRepo.save(event);
      await this.auditLogs.log({
        action: 'event.completed',
        entityType: 'event',
        entityId: event.id,
        actorId: null,
        metadata: { actorType: 'system', hotelId: event.hotelId },
      });
      completed += 1;
    }
    return { completed };
  }
}
