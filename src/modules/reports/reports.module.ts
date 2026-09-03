import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventBooking } from '../events/event-booking.entity';
import { Event } from '../events/event.entity';
import { EventsModule } from '../events/events.module';
import { FnbOrderLine } from '../fnb/fnb-order-line.entity';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { FnbModule } from '../fnb/fnb.module';
import { Hotel } from '../hotels/hotel.entity';
import { HousekeepingEvent } from '../housekeeping/housekeeping-event.entity';
import { HousekeepingModule } from '../housekeeping/housekeeping.module';
import { RequestCategory } from '../requests/request-category.entity';
import { GuestRequest } from '../requests/request.entity';
import { StaySettlementModule } from '../stay-settlement/stay-settlement.module';
import { Room } from '../tenant-rooms/room.entity';
import { StayRoomChange } from '../tenant-stays/stay-room-change.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ReportsBalancesService } from './reports-balances.service';
import { ReportsOperationalService } from './reports-operational.service';
import { ReportsRevenueService } from './reports-revenue.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Stay,
      Room,
      Hotel,
      GuestRequest,
      RequestCategory,
      HousekeepingEvent,
      StayRoomChange,
      TenantUser,
      FnbOrder,
      FnbOrderLine,
      Event,
      EventBooking,
    ]),
    StaySettlementModule,
    HousekeepingModule,
    FnbModule,
    EventsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsBalancesService, ReportsOperationalService, ReportsRevenueService],
})
export class ReportsModule {}
