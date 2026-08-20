import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Passport wrapper for the `guest-jwt` strategy (Epic 13). Provided as an
 * injectable (not APP_GUARD) so JwtAuthGuard can delegate to it on
 * @GuestScope() routes — same wiring as TenantJwtAuthGuard.
 */
@Injectable()
export class GuestJwtAuthGuard extends AuthGuard('guest-jwt') {}
