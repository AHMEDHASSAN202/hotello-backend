import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TenantJwtAuthGuard } from './tenant-jwt-auth.guard';

/**
 * The guard dispatch is what enforces strategy separation (Story 8.3 AC3):
 * @TenantScope() routes go through the tenant-jwt strategy, everything else
 * through the admin jwt strategy. Here we assert the *dispatch*; the secrets
 * themselves make cross-audience tokens fail at the passport layer.
 */
describe('JwtAuthGuard dispatch (8.3 AC3)', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let tenantGuard: { canActivate: jest.Mock };
  let guard: JwtAuthGuard;

  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  const withMetadata = (isPublic = false, tenantScope = false) =>
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return isPublic;
      if (key === TENANT_SCOPE_KEY) return tenantScope;
      return undefined;
    });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    tenantGuard = { canActivate: jest.fn().mockReturnValue('tenant-result') };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      tenantGuard as unknown as TenantJwtAuthGuard,
    );
  });

  it('lets @Public() routes through without any strategy', () => {
    withMetadata(true, false);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(tenantGuard.canActivate).not.toHaveBeenCalled();
  });

  it('delegates @TenantScope() routes to the tenant-jwt guard', () => {
    withMetadata(false, true);
    expect(guard.canActivate(ctx)).toBe('tenant-result');
    expect(tenantGuard.canActivate).toHaveBeenCalledWith(ctx);
  });

  it('uses the admin jwt strategy for ordinary routes', () => {
    withMetadata(false, false);
    const superSpy = jest
      .spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(guard)),
        'canActivate',
      )
      .mockReturnValue('admin-result');
    expect(guard.canActivate(ctx)).toBe('admin-result');
    expect(tenantGuard.canActivate).not.toHaveBeenCalled();
    superSpy.mockRestore();
  });
});
