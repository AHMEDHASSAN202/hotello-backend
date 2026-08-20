import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsModule } from '../hotels/tenant-urls.module';
import { Room } from '../tenant-rooms/room.entity';
import { StayCodeService } from './stay-code.service';
import { Stay } from './stay.entity';
import { TenantStaysController } from './tenant-stays.controller';
import { TenantStaysService } from './tenant-stays.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stay, Room, Hotel]),
    AuditLogsModule,
    TenantUrlsModule,
  ],
  controllers: [TenantStaysController],
  providers: [TenantStaysService, StayCodeService],
  exports: [TenantStaysService, StayCodeService],
})
export class TenantStaysModule {}
