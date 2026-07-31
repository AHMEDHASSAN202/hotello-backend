import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TenantAccessModule } from '../tenant-access/tenant-access.module';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantRole } from './tenant-role.entity';
import { TenantRolesController } from './tenant-roles.controller';
import { TenantRolesService } from './tenant-roles.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantRole, TenantUser]),
    AuditLogsModule,
    TenantAccessModule,
  ],
  controllers: [TenantRolesController],
  providers: [TenantRolesService],
  exports: [TenantRolesService, TypeOrmModule],
})
export class TenantRolesModule {}
