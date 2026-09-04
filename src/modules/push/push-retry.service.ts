import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PushDispatchService } from './push-dispatch.service';

/**
 * Cron triggers only (mirrors NotificationRetryService) — the actual work
 * lives in PushDispatchService.processDue()/pruneOld() so it stays
 * unit-testable. Two independent re-entrancy flags: a slow daily prune must
 * never block the every-minute retry poller, and vice versa.
 */
@Injectable()
export class PushRetryService {
  private readonly logger = new Logger(PushRetryService.name);

  /**
   * @nestjs/schedule does not serialize overlapping cron runs — if a batch
   * outlives the 1-minute interval, the next tick would re-select the same
   * still-pending rows and double-send. Skip instead.
   */
  private runningRetry = false;
  private runningPrune = false;

  constructor(private readonly dispatch: PushDispatchService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDueDispatches() {
    if (this.runningRetry) {
      this.logger.warn('Previous push retry batch still running — skipping tick');
      return;
    }
    this.runningRetry = true;
    try {
      const count = await this.dispatch.processDue();
      if (count > 0) {
        this.logger.log(`Processed ${count} due push dispatch(es)`);
      }
    } finally {
      this.runningRetry = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handlePrune() {
    if (this.runningPrune) {
      this.logger.warn('Previous push prune run still running — skipping tick');
      return;
    }
    this.runningPrune = true;
    try {
      const count = await this.dispatch.pruneOld();
      if (count > 0) {
        this.logger.log(`Pruned ${count} old push dispatch row(s)`);
      }
    } finally {
      this.runningPrune = false;
    }
  }
}
