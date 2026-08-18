import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { TenantRole } from '../tenant-roles/tenant-role.entity';
import { Room } from '../tenant-rooms/room.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantProfileController } from './tenant-profile.controller';
import { TenantProfileService } from './tenant-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantUser, TenantRole, Room]),
    TenantAccessModule,
    AuditLogsModule,
  ],
  controllers: [TenantProfileController],
  providers: [TenantProfileService],
})
export class TenantProfileModule {}
