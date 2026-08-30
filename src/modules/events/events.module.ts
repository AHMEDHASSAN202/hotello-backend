import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { RenditionsModule } from '../renditions/renditions.module';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { Stay } from '../tenant-stays/stay.entity';
import { EventBooking } from './event-booking.entity';
import { Event } from './event.entity';
import { EventPhotoService } from './event-photo.service';
import { EventSchedulerService } from './event-scheduler.service';
import { EventSettlementSource } from './event-settlement-source';
import { GuestEventsController } from './guest-events.controller';
import { GuestEventsService } from './guest-events.service';
import { TenantEventAttendeesController } from './tenant-event-attendees.controller';
import { TenantEventAttendeesService } from './tenant-event-attendees.service';
import { TenantEventsController } from './tenant-events.controller';
import { TenantEventsService } from './tenant-events.service';

/**
 * Epic 21 — Events & Workshops. Controllers and services join task by task
 * (the F&B/Announcements pattern). Story 21.2: tenant CRUD + photo +
 * publish/cancel (Task 6, imports `AnnouncementsModule` for its exported
 * `TenantAnnouncementsService` — the Epic 19 integration). Story 21.4/21.5
 * (Task 7): guest browse/book/my-bookings/self-cancel — the ONLY writer of
 * `EventBooking` rows in normal operation, so attendees (Task 8) and
 * settlement (Task 9) both depend on this landing first. Task 8: the
 * read-only attendee list + live totals — its own controller/service,
 * batch-loading `Stay` (with `room`) for guest name / room number since
 * `EventBooking` doesn't snapshot those fields. Task 9: `EventSettlementSource`
 * exported for `StaySettlementModule` — the events side of the shared
 * `SettlementSource` interface (Story 21.6 AC2), mirroring `FnbSettlementSource`.
 * Task 10: `EventSchedulerService` — the 5-minute completion-tick job
 * (Story 21.2 AC2), the Announcements/Housekeeping cron pattern.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Event, EventBooking, HotelInfoEntry, Hotel, Stay]),
    TenantAccessModule,
    AuditLogsModule,
    RenditionsModule,
    AnnouncementsModule,
  ],
  controllers: [
    TenantEventsController,
    TenantEventAttendeesController,
    GuestEventsController,
  ],
  providers: [
    TenantEventsService,
    EventPhotoService,
    TenantEventAttendeesService,
    GuestEventsService,
    EventSettlementSource,
    EventSchedulerService,
  ],
  exports: [EventSettlementSource],
})
export class EventsModule {}
