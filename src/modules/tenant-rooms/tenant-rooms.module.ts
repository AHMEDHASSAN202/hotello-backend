import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsModule } from '../hotels/tenant-urls.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PdfRendererService } from './pdf/pdf-renderer.service';
import { RoomsPdfService } from './pdf/rooms-pdf.service';
import { RoomQrService } from './room-qr.service';
import { RoomTypesController } from './room-types.controller';
import { Room } from './room.entity';
import { RoomType } from './room-type.entity';
import { RoomTypesService } from './room-types.service';
import { TenantRoomsController } from './tenant-rooms.controller';
import { TenantRoomsService } from './tenant-rooms.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomType, Hotel]),
    AuditLogsModule,
    SubscriptionsModule,
    // Story 11.5 — the guest-URL builder for QR codes. Imports the leaf
    // `TenantUrlsModule`, not `HotelsModule` itself: `HotelsModule` already
    // imports this module (for `RoomTypesService`, onboarding's default room
    // types), so importing `HotelsModule` back here would be a cycle.
    TenantUrlsModule,
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
  ],
  exports: [RoomTypesService, TenantRoomsService, TypeOrmModule],
})
export class TenantRoomsModule {}
