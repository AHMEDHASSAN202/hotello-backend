import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';
import { TenantJwtAuthGuard } from './tenant-jwt-auth.guard';

/**
 * Global guard: every route requires a valid JWT unless marked @Public().
 *
 * Routes marked @TenantScope() are authenticated by the tenant-jwt strategy
 * (via TenantJwtAuthGuard) instead of the platform-admin jwt strategy. Because
 * the two strategies verify with different secrets, a platform-admin token is
 * cryptographically rejected on tenant routes and vice versa (Story 8.3 AC3).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantGuard: TenantJwtAuthGuard,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isTenantScope = this.reflector.getAllAndOverride<boolean>(
      TENANT_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isTenantScope) return this.tenantGuard.canActivate(context);

    return super.canActivate(context);
  }
}
