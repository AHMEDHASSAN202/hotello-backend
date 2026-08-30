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
import { GuestEventsController } from './guest-events.controller';
import { GuestEventsService } from './guest-events.service';
import { TenantEventsController } from './tenant-events.controller';
import { TenantEventsService } from './tenant-events.service';

/**
 * Epic 21 — Events & Workshops. Controllers and services join task by task
 * (the F&B/Announcements pattern). Story 21.2: tenant CRUD + photo +
 * publish/cancel (Task 6, imports `AnnouncementsModule` for its exported
 * `TenantAnnouncementsService` — the Epic 19 integration). Story 21.4/21.5
 * (Task 7): guest browse/book/my-bookings/self-cancel — the ONLY writer of
 * `EventBooking` rows in normal operation, so attendees (Task 8) and
 * settlement (Task 9) both depend on this landing first.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Event, EventBooking, HotelInfoEntry, Hotel]),
    TenantAccessModule,
    AuditLogsModule,
    RenditionsModule,
    AnnouncementsModule,
  ],
  controllers: [TenantEventsController, GuestEventsController],
  providers: [TenantEventsService, EventPhotoService, GuestEventsService],
})
export class EventsModule {}
