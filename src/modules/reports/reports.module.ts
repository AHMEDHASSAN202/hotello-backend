import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { StaySettlementModule } from '../stay-settlement/stay-settlement.module';
import { Room } from '../tenant-rooms/room.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { ReportsBalancesService } from './reports-balances.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Stay, Room, Hotel]), StaySettlementModule],
  controllers: [ReportsController],
  providers: [ReportsBalancesService],
})
export class ReportsModule {}
