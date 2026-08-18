import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
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
  ],
  // RoomTypesController first: `tenant/room-types` must never fall through
  // TenantRoomsController's `tenant/rooms/:id` wildcard.
  controllers: [RoomTypesController, TenantRoomsController],
  providers: [RoomTypesService, TenantRoomsService],
  exports: [RoomTypesService, TenantRoomsService, TypeOrmModule],
})
export class TenantRoomsModule {}
