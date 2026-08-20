import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { GUEST_SCOPE_KEY } from '../decorators/guest-scope.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';
import { GuestJwtAuthGuard } from './guest-jwt-auth.guard';
import { TenantJwtAuthGuard } from './tenant-jwt-auth.guard';

/**
 * Global guard: every route requires a valid JWT unless marked @Public().
 *
 * Routes marked @TenantScope() are authenticated by the tenant-jwt strategy
 * (via TenantJwtAuthGuard) instead of the platform-admin jwt strategy;
 * @GuestScope() routes (Epic 13) go to the guest-jwt strategy the same way.
 * Because the three strategies verify with different secrets (and the guest
 * token carries an explicit `guest` audience), a token from one universe is
 * cryptographically rejected in the others (Story 8.3 AC3, 13.5).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantGuard: TenantJwtAuthGuard,
    private readonly guestGuard: GuestJwtAuthGuard,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isGuestScope = this.reflector.getAllAndOverride<boolean>(
      GUEST_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isGuestScope) return this.guestGuard.canActivate(context);

    const isTenantScope = this.reflector.getAllAndOverride<boolean>(
      TENANT_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isTenantScope) return this.tenantGuard.canActivate(context);

    return super.canActivate(context);
  }
}
