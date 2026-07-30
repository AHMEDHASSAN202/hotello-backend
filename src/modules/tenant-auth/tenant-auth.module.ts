import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantAuthController } from './tenant-auth.controller';
import { TenantAuthService } from './tenant-auth.service';
import { TenantJwtStrategy } from './strategies/tenant-jwt.strategy';
import { TenantTokenService } from './tenant-token.service';

@Module({
  imports: [
    // Own forFeature so this module doesn't depend on TenantUsersModule
    // (which depends back on this module for TenantTokenService).
    TypeOrmModule.forFeature([TenantUser, Hotel]),
    PassportModule,
    JwtModule.register({}),
    AuditLogsModule,
  ],
  controllers: [TenantAuthController],
  providers: [TenantAuthService, TenantTokenService, TenantJwtStrategy],
  exports: [TenantTokenService],
})
export class TenantAuthModule {}
