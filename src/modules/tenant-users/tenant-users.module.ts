import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantAuthModule } from '../tenant-auth/tenant-auth.module';
import { TenantUser } from './tenant-user.entity';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantUser, Hotel]),
    AuditLogsModule,
    // Provides TenantTokenService for setup auto-login (Story 8.2 AC3).
    TenantAuthModule,
  ],
  controllers: [TenantUsersController],
  providers: [TenantUsersService],
  exports: [TenantUsersService, TypeOrmModule],
})
export class TenantUsersModule {}
