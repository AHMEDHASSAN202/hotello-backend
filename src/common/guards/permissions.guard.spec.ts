import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard (SA-AUTH-6 / SA-ROLE-5)', () => {
  let guard: PermissionsGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const contextFor = (user: unknown): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PermissionsGuard(reflector as unknown as Reflector);
  });

  it('allows routes with no @RequirePermissions metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('allows when the role holds every required permission', () => {
    reflector.getAllAndOverride.mockReturnValue(['admins.read']);
    const user = { role: { permissions: ['admins.read', 'roles.read'] } };
    expect(guard.canActivate(contextFor(user))).toBe(true);
  });

  it("allows any permission via the '*' wildcard", () => {
    reflector.getAllAndOverride.mockReturnValue(['admins.delete']);
    const user = { role: { permissions: ['*'] } };
    expect(guard.canActivate(contextFor(user))).toBe(true);
  });

  it('throws 403 when a required permission is missing', () => {
    reflector.getAllAndOverride.mockReturnValue(['admins.delete']);
    const user = { role: { permissions: ['admins.read'] } };
    expect(() => guard.canActivate(contextFor(user))).toThrow(
      ForbiddenException,
    );
  });

  it('throws 403 when there is no user on the request', () => {
    reflector.getAllAndOverride.mockReturnValue(['admins.read']);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
