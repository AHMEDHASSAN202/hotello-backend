import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Cron trigger only — the expiry logic lives in
 * SubscriptionsService.expireOverdueTrials() so it stays unit-testable.
 */
@Injectable()
export class TrialExpiryService {
  private readonly logger = new Logger(TrialExpiryService.name);

  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyExpiry() {
    // Countdowns first (Story 6.5): an already-overdue trial must get the
    // expiry notice, not a stale countdown. Isolated so a countdown failure
    // can never block the expiry pass — flipping overdue trials to
    // read-only is the job's core duty (Story 4.10 AC1).
    let reminded = 0;
    try {
      reminded = await this.subscriptions.emitTrialCountdowns();
    } catch (err) {
      this.logger.error(
        `Trial countdown emission failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    const count = await this.subscriptions.expireOverdueTrials();
    this.logger.log(
      `Daily trial run complete (${reminded} countdown(s), ${count} expired)`,
    );
  }
}
