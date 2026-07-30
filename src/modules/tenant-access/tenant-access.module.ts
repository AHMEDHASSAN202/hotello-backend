import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { Subscription } from '../subscriptions/subscription.entity';
import { TenantUsersModule } from '../tenant-users/tenant-users.module';
import { TenantPublicController } from './tenant-public.controller';
import { TenantAccessService } from './tenant-access.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Hotel, Subscription]),
    // For the setup-preview endpoint.
    TenantUsersModule,
  ],
  controllers: [TenantPublicController],
  providers: [TenantAccessService],
  // Exported so the global TenantAccessGuard (provided in AppModule) can inject it.
  exports: [TenantAccessService],
})
export class TenantAccessModule {}
