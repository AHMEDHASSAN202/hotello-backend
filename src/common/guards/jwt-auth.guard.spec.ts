import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUEST_SCOPE_KEY } from '../decorators/guest-scope.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';
import { GuestJwtAuthGuard } from './guest-jwt-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TenantJwtAuthGuard } from './tenant-jwt-auth.guard';

/**
 * The guard dispatch is what enforces strategy separation (Story 8.3 AC3,
 * Epic 13 note 2): @TenantScope() → tenant-jwt, @GuestScope() → guest-jwt,
 * everything else → the admin jwt strategy. Here we assert the *dispatch*;
 * the distinct secrets/audience make cross-universe tokens fail at the
 * passport layer.
 */
describe('JwtAuthGuard dispatch (8.3 AC3 / 13.5)', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let tenantGuard: { canActivate: jest.Mock };
  let guestGuard: { canActivate: jest.Mock };
  let guard: JwtAuthGuard;

  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  const withMetadata = (
    isPublic = false,
    tenantScope = false,
    guestScope = false,
  ) =>
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return isPublic;
      if (key === TENANT_SCOPE_KEY) return tenantScope;
      if (key === GUEST_SCOPE_KEY) return guestScope;
      return undefined;
    });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    tenantGuard = { canActivate: jest.fn().mockReturnValue('tenant-result') };
    guestGuard = { canActivate: jest.fn().mockReturnValue('guest-result') };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      tenantGuard as unknown as TenantJwtAuthGuard,
      guestGuard as unknown as GuestJwtAuthGuard,
    );
  });

  it('lets @Public() routes through without any strategy', () => {
    withMetadata(true, false, false);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(tenantGuard.canActivate).not.toHaveBeenCalled();
    expect(guestGuard.canActivate).not.toHaveBeenCalled();
  });

  it('delegates @TenantScope() routes to the tenant-jwt guard', () => {
    withMetadata(false, true, false);
    expect(guard.canActivate(ctx)).toBe('tenant-result');
    expect(tenantGuard.canActivate).toHaveBeenCalledWith(ctx);
    expect(guestGuard.canActivate).not.toHaveBeenCalled();
  });

  it('delegates @GuestScope() routes to the guest-jwt guard (13.5)', () => {
    withMetadata(false, false, true);
    expect(guard.canActivate(ctx)).toBe('guest-result');
    expect(guestGuard.canActivate).toHaveBeenCalledWith(ctx);
    expect(tenantGuard.canActivate).not.toHaveBeenCalled();
  });

  it('uses the admin jwt strategy for ordinary routes', () => {
    withMetadata(false, false, false);
    const superSpy = jest
      .spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(guard)),
        'canActivate',
      )
      .mockReturnValue('admin-result');
    expect(guard.canActivate(ctx)).toBe('admin-result');
    expect(tenantGuard.canActivate).not.toHaveBeenCalled();
    expect(guestGuard.canActivate).not.toHaveBeenCalled();
    superSpy.mockRestore();
  });
});
