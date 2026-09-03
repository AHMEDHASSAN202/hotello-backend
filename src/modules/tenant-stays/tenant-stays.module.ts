import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsModule } from '../hotels/tenant-urls.module';
import { HousekeepingModule } from '../housekeeping/housekeeping.module';
import { StaySettlementModule } from '../stay-settlement/stay-settlement.module';
import { Room } from '../tenant-rooms/room.entity';
import { AutoCheckoutService } from './auto-checkout.service';
import { StayCodeService } from './stay-code.service';
import { StayRoomChange } from './stay-room-change.entity';
import { Stay } from './stay.entity';
import { TenantStaysController } from './tenant-stays.controller';
import { TenantStaysService } from './tenant-stays.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stay, Room, Hotel, StayRoomChange]),
    AuditLogsModule,
    TenantUrlsModule,
    // Epic 20 — one-way dependency for the vacate hook (note 3).
    HousekeepingModule,
    // Epic 22 (B2d; scoping restructured in the final review, I3) —
    // TenantStaysService injects StaySettlementService for the hasBalance
    // filter/decoration. StaySettlementModule already imports this module
    // (for TenantStaysService.findStayInHotel), so this edge creates a
    // direct 2-module cycle; forwardRef() on both sides breaks it.
    forwardRef(() => StaySettlementModule),
  ],
  controllers: [TenantStaysController],
  providers: [TenantStaysService, StayCodeService, AutoCheckoutService],
  exports: [TenantStaysService, StayCodeService],
})
export class TenantStaysModule {}
