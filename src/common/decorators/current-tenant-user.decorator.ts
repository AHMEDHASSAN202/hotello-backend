import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Injects the authenticated TenantUser entity loaded by the tenant-jwt strategy. */
export const CurrentTenantUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest().user,
);
