import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { Room } from '../tenant-rooms/room.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { GuestHousekeepingController } from './guest-housekeeping.controller';
import { HousekeepingSchedulerService } from './housekeeping-scheduler.service';
import { HousekeepingService } from './housekeeping.service';
import { TenantHousekeepingController } from './tenant-housekeeping.controller';

/**
 * Epic 20 — Housekeeping Operations: the board + lifecycle (tenant tree), the
 * guest DND toggle (guest tree) and the daily service tick. Imports entities
 * directly (one-way dependency): TenantStaysModule imports this module for
 * the vacate hook, never the reverse.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Room, Stay, Hotel, TenantUser]),
    TenantAccessModule,
    AuditLogsModule,
  ],
  controllers: [TenantHousekeepingController, GuestHousekeepingController],
  providers: [HousekeepingService, HousekeepingSchedulerService],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
