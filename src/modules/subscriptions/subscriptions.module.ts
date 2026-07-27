import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { Plan } from '../plans/plan.entity';
import { Subscription } from './subscription.entity';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { TrialExpiryService } from './trial-expiry.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Plan, Hotel]),
    AuditLogsModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, TrialExpiryService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
