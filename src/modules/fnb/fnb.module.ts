import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsModule } from '../hotels/tenant-urls.module';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { TenantRoomsModule } from '../tenant-rooms/tenant-rooms.module';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbStickerPdfService } from './fnb-sticker-pdf.service';
import { TenantFnbLocationsController } from './tenant-fnb-locations.controller';
import { TenantFnbLocationsService } from './tenant-fnb-locations.service';
import { FnbItem } from './fnb-item.entity';
import { FnbLocation } from './fnb-location.entity';
import { FnbMenuSection } from './fnb-menu-section.entity';
import { FnbMenu } from './fnb-menu.entity';
import { FnbOrderLine } from './fnb-order-line.entity';
import { FnbOrder } from './fnb-order.entity';
import { FnbPhotoService } from './fnb-photo.service';
import { TenantFnbMenusController } from './tenant-fnb-menus.controller';
import { TenantFnbMenusService } from './tenant-fnb-menus.service';

/**
 * Epic 16 — F&B ordering: menus, delivery locations, settings, guest
 * ordering and the kitchen board, serving both auth universes (guest tree +
 * tenant tree) from one module. Controllers/services join task by task.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FnbMenu,
      FnbMenuSection,
      FnbItem,
      FnbLocation,
      FnbOrder,
      FnbOrderLine,
      Hotel,
      TenantUser,
    ]),
    TenantAccessModule,
    AuditLogsModule,
    // Epic 11 machinery reused wholesale: Playwright renderer + QR service
    // (exported by TenantRoomsModule) and the guest-URL builder.
    TenantRoomsModule,
    TenantUrlsModule,
  ],
  controllers: [TenantFnbMenusController, TenantFnbLocationsController],
  providers: [
    TenantFnbMenusService,
    FnbPhotoService,
    TenantFnbLocationsService,
    FnbStickerPdfService,
  ],
  exports: [],
})
export class FnbModule {}
