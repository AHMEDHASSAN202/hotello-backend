import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Plan } from '../plans/plan.entity';
import { Subscription } from '../subscriptions/subscription.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersModule } from '../tenant-users/tenant-users.module';
import { HotelOnboardingService } from './hotel-onboarding.service';
import { Hotel } from './hotel.entity';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { TenantUrlsService } from './tenant-urls.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Hotel, Subscription, Plan, TenantUser]),
    SubscriptionsModule,
    TenantUsersModule,
    AuditLogsModule,
  ],
  controllers: [HotelsController],
  providers: [HotelsService, HotelOnboardingService, TenantUrlsService],
  exports: [TypeOrmModule],
})
export class HotelsModule {}
