import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';
import { SUBSCRIPTION_EXEMPT_KEY } from '../decorators/subscription-exempt.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';
import { TenantAccessService } from '../../modules/tenant-access/tenant-access.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Third global guard (after authenticate + authorize). A no-op for admin and
 * public routes; for authenticated @TenantScope() routes it enforces, from the
 * hotel's live access state (Story 8.6):
 *   - suspended hotel        → 403 HOTEL_SUSPENDED
 *   - module not in the plan → 403 MODULE_NOT_ENABLED
 *   - mutation while read-only (expired/canceled), non-exempt route
 *                            → 403 SUBSCRIPTION_READ_ONLY
 * The error codes are what the UI maps to translated explanations + conversion
 * prompts.
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: TenantAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = <T>(key: string) =>
      this.reflector.getAllAndOverride<T>(key, [
        context.getHandler(),
        context.getClass(),
      ]);

    // Only tenant-scoped, authenticated routes are gated.
    if (!meta<boolean>(TENANT_SCOPE_KEY)) return true;
    if (meta<boolean>(IS_PUBLIC_KEY)) return true;

    const req = context.switchToHttp().getRequest();
    const hotelId: string | undefined = req.user?.hotelId;
    if (!hotelId) return true; // no authenticated tenant user → nothing to gate

    const state = await this.access.getAccessState(hotelId);

    if (state.hotelStatus === 'suspended') {
      throw new ForbiddenException({
        code: 'HOTEL_SUSPENDED',
        message: 'This hotel is currently unavailable',
      });
    }

    const requiredModule = meta<string>(REQUIRE_MODULE_KEY);
    if (requiredModule && !state.enabledModules.includes(requiredModule)) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: 'This module is not included in your plan',
        module: requiredModule,
      });
    }

    const isMutation = MUTATING_METHODS.has(req.method);
    const exempt = meta<boolean>(SUBSCRIPTION_EXEMPT_KEY);
    if (isMutation && state.readOnly && !exempt) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_READ_ONLY',
        message:
          'Your subscription has expired — the dashboard is read-only until you renew',
      });
    }

    return true;
  }
}
