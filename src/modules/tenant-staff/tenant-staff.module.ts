import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TenantRolesModule } from '../tenant-roles/tenant-roles.module';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersModule } from '../tenant-users/tenant-users.module';
import { TenantStaffController } from './tenant-staff.controller';
import { TenantStaffService } from './tenant-staff.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantUser, Hotel]),
    TenantRolesModule,
    TenantUsersModule,
    SubscriptionsModule,
    AuditLogsModule,
  ],
  controllers: [TenantStaffController],
  providers: [TenantStaffService],
})
export class TenantStaffModule {}
