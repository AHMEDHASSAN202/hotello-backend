import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantStaysModule } from '../tenant-stays/tenant-stays.module';
import { GuestController } from './guest.controller';
import { GuestRateLimitService } from './guest-rate-limit.service';
import { GuestSessionService } from './guest-session.service';
import { GuestJwtStrategy } from './strategies/guest-jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stay, Hotel]),
    PassportModule,
    JwtModule.register({}),
    TenantStaysModule, // StayCodeService — one hashing implementation
  ],
  controllers: [GuestController],
  providers: [GuestSessionService, GuestRateLimitService, GuestJwtStrategy],
})
export class GuestModule {}
