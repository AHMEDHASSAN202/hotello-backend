import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PASSWORD_CHANGE_EXEMPT_KEY } from '../decorators/password-change-exempt.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';

/**
 * Fourth global guard. A no-op for admin/public routes; for authenticated
 * @TenantScope() routes it blocks everything except @PasswordChangeExempt()
 * routes while the user still holds a temporary password (Story 9.7 AC4).
 * The UI maps PASSWORD_CHANGE_REQUIRED to the forced change-password screen.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = <T>(key: string) =>
      this.reflector.getAllAndOverride<T>(key, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (!meta<boolean>(TENANT_SCOPE_KEY)) return true;
    if (meta<boolean>(IS_PUBLIC_KEY)) return true;
    if (meta<boolean>(PASSWORD_CHANGE_EXEMPT_KEY)) return true;

    const user = context.switchToHttp().getRequest().user;
    if (user?.mustChangePassword) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must set a new password before continuing',
      });
    }
    return true;
  }
}
