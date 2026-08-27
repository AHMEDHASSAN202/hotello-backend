import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { GuestHotelInfoController } from './guest-hotel-info.controller';
import { GuestHotelInfoService } from './guest-hotel-info.service';
import { HotelInfoEntry } from './hotel-info-entry.entity';
import { HotelInfoPhotoService } from './hotel-info-photo.service';
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
    TenantAccessModule,
  ],
  providers: [
    TenantHotelInfoService,
    HotelInfoPhotoService,
    GuestHotelInfoService,
  ],
  controllers: [TenantHotelInfoController, GuestHotelInfoController],
})
export class HotelInfoModule {}
