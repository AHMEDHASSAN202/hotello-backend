import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventBooking } from './event-booking.entity';
import { Event } from './event.entity';

/**
 * Epic 21 — Events & Workshops. Schema-only skeleton for now; controllers
 * and services join task by task (the F&B/Announcements pattern).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Event, EventBooking])],
  controllers: [],
  providers: [],
})
export class EventsModule {}
