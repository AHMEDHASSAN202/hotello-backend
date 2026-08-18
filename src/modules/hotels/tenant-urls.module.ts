import { Module } from '@nestjs/common';
import { TenantUrlsService } from './tenant-urls.service';

/**
 * Story 11.5 — `TenantUrlsService` only depends on `ConfigService` (no Hotel
 * entity, no other hotels-module wiring), so it lives in its own tiny module.
 * `HotelsModule` already imports `TenantRoomsModule` (for `RoomTypesService`,
 * used by onboarding to seed default room types) — if `TenantRoomsModule`
 * imported `HotelsModule` back to reach `TenantUrlsService`, that would be a
 * module cycle. Both sides importing this leaf module instead avoids it
 * without `forwardRef`.
 */
@Module({
  providers: [TenantUrlsService],
  exports: [TenantUrlsService],
})
export class TenantUrlsModule {}
