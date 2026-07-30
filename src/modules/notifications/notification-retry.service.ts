import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

/**
 * Cron trigger only (mirrors TrialExpiryService) — the retry logic lives in
 * NotificationsService.processDue() so it stays unit-testable.
 */
@Injectable()
export class NotificationRetryService {
  private readonly logger = new Logger(NotificationRetryService.name);

  /**
   * @nestjs/schedule does not serialize overlapping cron runs — if a batch
   * outlives the 1-minute interval (hung SMTP host), the next tick would
   * re-select the same still-pending rows and double-send. Skip instead.
   */
  private running = false;

  constructor(private readonly notifications: NotificationsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDueNotifications() {
    if (this.running) {
      this.logger.warn('Previous retry batch still running — skipping tick');
      return;
    }
    this.running = true;
    try {
      const count = await this.notifications.processDue();
      if (count > 0) {
        this.logger.log(`Processed ${count} due notification(s)`);
      }
    } finally {
      this.running = false;
    }
  }
}
