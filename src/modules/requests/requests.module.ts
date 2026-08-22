import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { GuestRequestsController } from './guest-requests.controller';
import { GuestRequestsService } from './guest-requests.service';
import { HotelRequestCategorySetting } from './hotel-request-category-setting.entity';
import { HotelRequestItemSetting } from './hotel-request-item-setting.entity';
import { RequestCatalogViewService } from './request-catalog-view.service';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';
import { GuestRequest } from './request.entity';

/**
 * Epic 15 — Guest Requests: the shared catalog + the request lifecycle,
 * serving both auth universes (guest tree + tenant tree) from one module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RequestCategory,
      RequestItem,
      HotelRequestCategorySetting,
      HotelRequestItemSetting,
      GuestRequest,
    ]),
    TenantAccessModule,
    AuditLogsModule,
  ],
  controllers: [GuestRequestsController],
  providers: [RequestCatalogViewService, GuestRequestsService],
})
export class RequestsModule {}
