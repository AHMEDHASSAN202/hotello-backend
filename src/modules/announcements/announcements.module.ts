import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { Announcement } from './announcement.entity';
import { AnnouncementRead } from './announcement-read.entity';
import { AnnouncementSchedulerService } from './announcement-scheduler.service';
import { GuestAnnouncementsController } from './guest-announcements.controller';
import { GuestAnnouncementsService } from './guest-announcements.service';
import { TenantAnnouncementsController } from './tenant-announcements.controller';
import { TenantAnnouncementsService } from './tenant-announcements.service';

/**
 * Epic 19 — Guest Announcements: tenant compose/schedule/retract + stats,
 * guest inbox feed, and the 5-minute scheduled→live→expired transition job.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Announcement,
      AnnouncementRead,
      Stay,
      Hotel,
      HotelInfoEntry,
    ]),
    AuditLogsModule,
    TenantAccessModule,
  ],
  controllers: [TenantAnnouncementsController, GuestAnnouncementsController],
  providers: [
    TenantAnnouncementsService,
    GuestAnnouncementsService,
    AnnouncementSchedulerService,
  ],
})
export class AnnouncementsModule {}
