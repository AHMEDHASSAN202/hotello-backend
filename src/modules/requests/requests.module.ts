import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { Room } from '../tenant-rooms/room.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { GuestRequestsController } from './guest-requests.controller';
import { GuestRequestsService } from './guest-requests.service';
import { HotelRequestCategorySetting } from './hotel-request-category-setting.entity';
import { HotelRequestItemSetting } from './hotel-request-item-setting.entity';
import { RequestCatalogViewService } from './request-catalog-view.service';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';
import { GuestRequest } from './request.entity';
import { TenantRequestCatalogController } from './tenant-request-catalog.controller';
import { TenantRequestCatalogService } from './tenant-request-catalog.service';
import { TenantRequestsController } from './tenant-requests.controller';
import { TenantRequestsService } from './tenant-requests.service';

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
      Stay,
      Room,
      TenantUser,
      Hotel,
    ]),
    TenantAccessModule,
    AuditLogsModule,
  ],
  controllers: [
    GuestRequestsController,
    TenantRequestsController,
    TenantRequestCatalogController,
  ],
  providers: [
    RequestCatalogViewService,
    GuestRequestsService,
    TenantRequestsService,
    TenantRequestCatalogService,
  ],
  exports: [TenantRequestsService],
})
export class RequestsModule {}
