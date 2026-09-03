import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsModule } from '../hotels/tenant-urls.module';
import { HotelSettingsModule } from '../hotel-settings/hotel-settings.module';
import { RenditionsModule } from '../renditions/renditions.module';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { TenantStaysModule } from '../tenant-stays/tenant-stays.module';
import { TenantRoomsModule } from '../tenant-rooms/tenant-rooms.module';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbSettlementSource } from './fnb-settlement-source';
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
import { GuestFnbController } from './guest-fnb.controller';
import { GuestFnbService } from './guest-fnb.service';
import { TenantFnbMenusController } from './tenant-fnb-menus.controller';
import { TenantFnbMenusService } from './tenant-fnb-menus.service';
import { TenantFnbSettingsController } from './tenant-fnb-settings.controller';
import { TenantFnbSettingsService } from './tenant-fnb-settings.service';
import { TenantFnbOrdersController } from './tenant-fnb-orders.controller';
import { TenantFnbOrdersService } from './tenant-fnb-orders.service';

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
    HotelSettingsModule,
    RenditionsModule,
    // Epic 11 machinery reused wholesale: Playwright renderer + QR service
    // (exported by TenantRoomsModule) and the guest-URL builder.
    // Epic 22 (B2d) correction: TenantRoomsModule now imports
    // StaySettlementModule, which imports this module — a plain top-level
    // `import { TenantRoomsModule } from ...` here closes a 3-file JS
    // require cycle (TenantRoomsModule -> StaySettlementModule -> FnbModule
    // -> TenantRoomsModule) that resolves this array element to `undefined`
    // (Nest's exact error named index [5] of this array). forwardRef()
    // defers the property read to Nest's later instantiation pass, by which
    // time the class binding is defined — required despite the brief's "do
    // not touch FnbModule" guidance, per its own instruction to follow
    // Nest's diagnostic when it points elsewhere.
    forwardRef(() => TenantRoomsModule),
    TenantUrlsModule,
    // Settlement + the stay drawer's orders list resolve stays through the
    // cross-tenant 404 chokepoint (TenantStaysService.findStayInHotel).
    TenantStaysModule,
  ],
  controllers: [
    GuestFnbController,
    TenantFnbMenusController,
    TenantFnbLocationsController,
    TenantFnbSettingsController,
    TenantFnbOrdersController,
  ],
  providers: [
    TenantFnbMenusService,
    FnbPhotoService,
    TenantFnbLocationsService,
    FnbStickerPdfService,
    TenantFnbSettingsService,
    GuestFnbService,
    TenantFnbOrdersService,
    FnbSettlementSource,
  ],
  // Story 21.6 AC2 — StaySettlementModule injects FnbSettlementSource for
  // the combined checkout total; nothing else needs the rest of the module.
  exports: [FnbSettlementSource],
})
export class FnbModule {}
