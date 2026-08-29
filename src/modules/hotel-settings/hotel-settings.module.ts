import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantPaymentSettingsController } from './tenant-payment-settings.controller';
import { TenantPaymentSettingsService } from './tenant-payment-settings.service';

/**
 * Epic 21, Story 21.1 AC2 — hotel-level settings shared across modules.
 * Payment-methods config (cash/room charge) lifted out of F&B so Events
 * (a later Epic 21 task) can read the same toggle. Exports the service so
 * other modules (F&B today, Events later) can delegate to it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Hotel]), AuditLogsModule],
  controllers: [TenantPaymentSettingsController],
  providers: [TenantPaymentSettingsService],
  exports: [TenantPaymentSettingsService],
})
export class HotelSettingsModule {}
