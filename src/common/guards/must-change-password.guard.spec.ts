import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PASSWORD_CHANGE_EXEMPT_KEY } from '../decorators/password-change-exempt.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';
import { MustChangePasswordGuard } from './must-change-password.guard';

describe('MustChangePasswordGuard (9.7 AC4)', () => {
  let guard: MustChangePasswordGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const ctx = (user: unknown): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const meta = (v: Record<string, unknown>) =>
    reflector.getAllAndOverride.mockImplementation((k: string) => v[k]);

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new MustChangePasswordGuard(reflector as unknown as Reflector);
  });

  it('ignores non-tenant routes', () => {
    meta({ [TENANT_SCOPE_KEY]: false });
    expect(guard.canActivate(ctx({ mustChangePassword: true }))).toBe(true);
  });

  it('blocks a must-change tenant user on a normal route (403 PASSWORD_CHANGE_REQUIRED)', () => {
    meta({ [TENANT_SCOPE_KEY]: true });
    expect(() =>
      guard.canActivate(ctx({ mustChangePassword: true })),
    ).toThrow(ForbiddenException);
  });

  it('allows exempt routes even while must-change is set', () => {
    meta({ [TENANT_SCOPE_KEY]: true, [PASSWORD_CHANGE_EXEMPT_KEY]: true });
    expect(guard.canActivate(ctx({ mustChangePassword: true }))).toBe(true);
  });

  it('allows public routes', () => {
    meta({ [TENANT_SCOPE_KEY]: true, [IS_PUBLIC_KEY]: true });
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('allows a user who does not need to change their password', () => {
    meta({ [TENANT_SCOPE_KEY]: true });
    expect(guard.canActivate(ctx({ mustChangePassword: false }))).toBe(true);
  });
});
