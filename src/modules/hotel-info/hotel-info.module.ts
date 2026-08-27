import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { HotelInfoEntry } from './hotel-info-entry.entity';
import { TenantHotelInfoController } from './tenant-hotel-info.controller';
import { TenantHotelInfoService } from './tenant-hotel-info.service';

/**
 * Epic 17 — Hotel Info / Directory: the digital in-room compendium, serving
 * both auth universes (tenant management + guest read) from one module.
 * Controllers/services join task by task.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([HotelInfoEntry, Hotel]),
    AuditLogsModule,
  ],
  providers: [TenantHotelInfoService],
  controllers: [TenantHotelInfoController],
})
export class HotelInfoModule {}
