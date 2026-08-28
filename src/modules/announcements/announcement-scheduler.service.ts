import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Announcement } from './announcement.entity';
import { hotelLocalStamp, isWithinWindow } from './announcement-visibility';

/**
 * 19.2 AC1 / spec note 4 — the Epic 13 jobs pattern (thin cron trigger,
 * `now`-injected testable method, re-entrancy flag) at a 5-minute cadence:
 * schedule granularity is minutes, and an hourly tick would land a 09:00
 * pool-closure notice at 10:00 (recorded decision). Expiry is ALSO enforced
 * in the visibility window check, so guests never see an expired item
 * between ticks — this job makes the status/history truthful.
 *
 * Idempotent — the query filters on status, so a re-run selects nothing
 * already flipped.
 */
@Injectable()
export class AnnouncementSchedulerService {
  private readonly logger = new Logger(AnnouncementSchedulerService.name);
  private running = false;

  constructor(
    @InjectRepository(Announcement)
    private readonly repo: Repository<Announcement>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleTick() {
    if (this.running) {
      this.logger.warn(
        'Previous announcement transition run still active — skipping tick',
      );
      return;
    }
    this.running = true;
    try {
      const { published, expired } = await this.transition();
      if (published || expired) {
        this.logger.log(
          `Announcement transitions: ${published} published, ${expired} expired`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Announcement transition run failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }

  async transition(
    now: Date = new Date(),
  ): Promise<{ published: number; expired: number }> {
    const candidates = await this.repo.find({
      where: { status: In(['scheduled', 'live']) },
      relations: ['hotel'],
    });

    let published = 0;
    let expired = 0;
    for (const row of candidates) {
      const nowLocal = hotelLocalStamp(row.hotel.timezone, now);

      if (row.status === 'scheduled') {
        if (!row.publishAtLocal || row.publishAtLocal > nowLocal) continue;
        row.status = 'live';
        row.publishedAt = now;
        await this.repo.save(row);
        await this.audit(row, 'announcement.published', {
          publishAtLocal: row.publishAtLocal,
        });
        published += 1;
        continue;
      }

      // live → expired once the hotel-local clock passes activeUntilLocal.
      if (isWithinWindow(row, nowLocal)) continue;
      row.status = 'expired';
      row.expiredAt = now;
      await this.repo.save(row);
      await this.audit(row, 'announcement.expired', {
        activeUntilLocal: row.activeUntilLocal,
      });
      expired += 1;
    }
    return { published, expired };
  }

  private async audit(
    row: Announcement,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action,
      entityType: 'announcement',
      entityId: row.id,
      actorId: null,
      metadata: { hotelId: row.hotelId, ...metadata },
    });
  }
}
