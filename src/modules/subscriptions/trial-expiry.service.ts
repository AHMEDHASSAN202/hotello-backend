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
    const count = await this.subscriptions.expireOverdueTrials();
    this.logger.log(`Daily trial expiry run complete (${count} expired)`);
  }
}
