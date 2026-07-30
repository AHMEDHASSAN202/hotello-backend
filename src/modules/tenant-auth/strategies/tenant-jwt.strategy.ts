import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { TenantUser } from '../../tenant-users/tenant-user.entity';

/**
 * The tenant JWT payload carries only `sub`. The tenant user (with hotel,
 * status and permissions) is loaded fresh from the DB on every request, so
 * deactivation and permission edits take effect immediately — never cache
 * permissions or hotel_id in the token (Story 8.3 AC3, 8.6 AC4). Hotel
 * suspension is enforced by TenantAccessGuard (coded 403), not here.
 *
 * Registered under the distinct name `tenant-jwt` and verified with its own
 * secret, so a platform-admin token is never accepted here.
 */
@Injectable()
export class TenantJwtStrategy extends PassportStrategy(Strategy, 'tenant-jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('TENANT_JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: { sub: string }): Promise<TenantUser> {
    const user = await this.tenantUsersRepo.findOne({
      where: { id: payload.sub },
      relations: ['hotel', 'role'],
    });
    // Identity/status only. Hotel suspension is NOT checked here — that belongs
    // to TenantAccessGuard, which returns the coded 403 HOTEL_SUSPENDED the UI
    // maps to the branded locked screen. A bare 401 here would shadow it.
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException();
    }
    return user;
  }
}
