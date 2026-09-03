import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsModule } from '../hotels/tenant-urls.module';
import { StaySettlementModule } from '../stay-settlement/stay-settlement.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PdfRendererService } from './pdf/pdf-renderer.service';
import { RoomsPdfService } from './pdf/rooms-pdf.service';
import { RoomQrService } from './room-qr.service';
import { RoomTypesController } from './room-types.controller';
import { Room } from './room.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { RoomType } from './room-type.entity';
import { RoomTypesService } from './room-types.service';
import { TenantRoomsController } from './tenant-rooms.controller';
import { TenantRoomsService } from './tenant-rooms.service';
import { RoomsXlsxService } from './xlsx/rooms-xlsx.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomType, Hotel, Stay, TenantUser]),
    AuditLogsModule,
    SubscriptionsModule,
    // Story 11.5 — the guest-URL builder for QR codes. Imports the leaf
    // `TenantUrlsModule`, not `HotelsModule` itself: `HotelsModule` already
    // imports this module (for `RoomTypesService`, onboarding's default room
    // types), so importing `HotelsModule` back here would be a cycle.
    TenantUrlsModule,
    // Epic 22 (B2d) — the controller injects StaySettlementService for the
    // hasBalance filter/decoration. StaySettlementModule -> FnbModule ->
    // TenantRoomsModule is an indirect cycle back to here; forwardRef() on
    // this edge (both sides) defers resolution enough to break it.
    forwardRef(() => StaySettlementModule),
  ],
  // RoomTypesController first: `tenant/room-types` must never fall through
  // TenantRoomsController's `tenant/rooms/:id` wildcard.
  controllers: [RoomTypesController, TenantRoomsController],
  providers: [
    RoomTypesService,
    TenantRoomsService,
    RoomQrService,
    // Story 11.5 — print-ready QR PDFs (poster + room cards). PdfRendererService
    // owns the Playwright/Chromium singleton; STORAGE_DRIVER (hotel logo bytes)
    // comes from the @Global() StorageModule, no import needed here.
    PdfRendererService,
    RoomsPdfService,
    // Story 11.7 — xlsx export + annotated import template. Pure workbook
    // builders (buildExport/buildTemplate) plus the thin per-hotel
    // orchestration the controller calls.
    RoomsXlsxService,
  ],
  // PdfRendererService + RoomQrService are deliberately shared: Epic 16's
  // location stickers reuse the same Chromium singleton and QR discipline.
  exports: [
    RoomTypesService,
    TenantRoomsService,
    TypeOrmModule,
    PdfRendererService,
    RoomQrService,
  ],
})
export class TenantRoomsModule {}
