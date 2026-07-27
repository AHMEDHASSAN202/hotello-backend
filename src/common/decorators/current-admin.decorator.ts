import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Injects the authenticated Admin entity loaded by the JWT strategy. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest().user,
);
