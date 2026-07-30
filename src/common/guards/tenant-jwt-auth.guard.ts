import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates tenant-dashboard requests with the `tenant-jwt` passport
 * strategy (separate secret from the platform-admin `jwt` strategy). Not wired
 * as an APP_GUARD directly — the global JwtAuthGuard delegates to it for routes
 * marked @TenantScope().
 */
@Injectable()
export class TenantJwtAuthGuard extends AuthGuard('tenant-jwt') {}
