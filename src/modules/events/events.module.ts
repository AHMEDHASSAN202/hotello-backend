import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { RenditionsModule } from '../renditions/renditions.module';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { EventBooking } from './event-booking.entity';
import { Event } from './event.entity';
import { EventPhotoService } from './event-photo.service';
import { TenantEventsController } from './tenant-events.controller';
import { TenantEventsService } from './tenant-events.service';

/**
 * Epic 21 — Events & Workshops. Controllers and services join task by task
 * (the F&B/Announcements pattern). Story 21.2: tenant CRUD + photo +
 * publish/cancel (Task 6, imports `AnnouncementsModule` for its exported
 * `TenantAnnouncementsService` — the Epic 19 integration). Guest booking
 * (Task 7) and attendees (Task 8) land in later module imports.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Event, EventBooking, HotelInfoEntry, Hotel]),
    TenantAccessModule,
    AuditLogsModule,
    RenditionsModule,
    AnnouncementsModule,
  ],
  controllers: [TenantEventsController],
  providers: [TenantEventsService, EventPhotoService],
})
export class EventsModule {}
