import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { WILDCARD } from '../../modules/roles/permissions.constants';

/**
 * Global guard: enforces @RequirePermissions(...) against the actor loaded
 * fresh from the DB by the JWT strategy. The '*' wildcard passes every check.
 *
 * Both platform admins and tenant users carry permissions on their role
 * (`user.role.permissions`) — the single source of truth. @TenantScope()
 * still selects which catalog/strategy authenticated the request; the read is
 * uniform.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Insufficient permissions');

    const permissions: string[] = user.role?.permissions ?? [];

    if (permissions.includes(WILDCARD)) return true;
    if (required.every((p) => permissions.includes(p))) return true;
    throw new ForbiddenException('Insufficient permissions');
  }
}
