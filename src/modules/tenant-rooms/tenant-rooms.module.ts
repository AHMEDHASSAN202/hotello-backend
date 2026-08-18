import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { RoomTypesController } from './room-types.controller';
import { Room } from './room.entity';
import { RoomType } from './room-type.entity';
import { RoomTypesService } from './room-types.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomType, Hotel]),
    AuditLogsModule,
  ],
  controllers: [RoomTypesController],
  providers: [RoomTypesService],
  exports: [RoomTypesService, TypeOrmModule],
})
export class TenantRoomsModule {}
