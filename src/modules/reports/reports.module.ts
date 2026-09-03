import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
    ]),
    StaySettlementModule,
    HousekeepingModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsBalancesService, ReportsOperationalService],
})
export class ReportsModule {}
