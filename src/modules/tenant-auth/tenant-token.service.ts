import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { TenantUser } from '../tenant-users/tenant-user.entity';

const BCRYPT_ROUNDS = 10;

export interface TenantTokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Issues and rotates tenant-dashboard tokens. Shared by TenantAuthService
 * (login/refresh) and TenantUsersService (setup auto-login, Story 8.2 AC3) so
 * the rotation + hashing semantics live in exactly one place.
 *
 * Tokens carry only `sub` (never permissions or hotel_id — those reload per
 * request in the tenant-jwt strategy). Signed with the tenant secrets, so they
 * are never valid on platform-admin routes.
 */
@Injectable()
export class TenantTokenService {
  constructor(
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Signs a new access/refresh pair and stores the bcrypt hash of the new
   * refresh token on the user (rotation), persisting the user.
   */
  async issueTokens(user: TenantUser): Promise<TenantTokenPair> {
    const payload = { sub: user.id };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow('TENANT_JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('TENANT_JWT_ACCESS_EXPIRES', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow('TENANT_JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('TENANT_JWT_REFRESH_EXPIRES', '7d'),
      }),
    ]);
    user.refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
    await this.tenantUsersRepo.save(user);
    return { accessToken, refreshToken };
  }

  /**
   * The public shape of a tenant user returned alongside tokens. `role` is the
   * assigned role object; `permissions` is flattened from it (the single source
   * of truth) so clients gate on a simple array. Callers must load the `role`
   * relation.
   */
  publicUser(user: TenantUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
        ? {
            id: user.role.id,
            nameEn: user.role.nameEn,
            nameAr: user.role.nameAr,
            isSystem: user.role.isSystem,
          }
        : null,
      permissions: user.role?.permissions ?? [],
      preferredLanguage: user.preferredLanguage,
    };
  }
}
