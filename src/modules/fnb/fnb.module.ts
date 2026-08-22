import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbItem } from './fnb-item.entity';
import { FnbLocation } from './fnb-location.entity';
import { FnbMenuSection } from './fnb-menu-section.entity';
import { FnbMenu } from './fnb-menu.entity';
import { FnbOrderLine } from './fnb-order-line.entity';
import { FnbOrder } from './fnb-order.entity';

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
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class FnbModule {}
