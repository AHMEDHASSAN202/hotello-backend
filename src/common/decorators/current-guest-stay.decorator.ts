import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Stay } from '../../modules/tenant-stays/stay.entity';

/**
 * The authenticated guest session's stay (loaded fresh by GuestJwtStrategy —
 * an already-checked-out stay never reaches a handler).
 */
export const CurrentGuestStay = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Stay => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
