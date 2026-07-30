import { SetMetadata } from '@nestjs/common';

export const REQUIRE_MODULE_KEY = 'requireModule';

/**
 * Gates a tenant route behind a plan module (Story 8.6 AC3). If the hotel's
 * plan doesn't enable this module, TenantAccessGuard returns 403
 * MODULE_NOT_ENABLED. Enforced backend-side, not just hidden in the UI.
 */
export const RequireModule = (moduleKey: string) =>
  SetMetadata(REQUIRE_MODULE_KEY, moduleKey);
