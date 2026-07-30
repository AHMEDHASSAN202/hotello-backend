import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard (SA-AUTH-6 / SA-ROLE-5 / 8.5)', () => {
  let guard: PermissionsGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const contextFor = (user: unknown): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  /** Reflector returns per-metadata-key values (the guard reads two keys). */
  const withMetadata = (required?: string[], tenantScope = false) =>
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_KEY) return required;
      if (key === TENANT_SCOPE_KEY) return tenantScope;
      return undefined;
    });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PermissionsGuard(reflector as unknown as Reflector);
  });

  it('allows routes with no @RequirePermissions metadata', () => {
    withMetadata(undefined);
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('allows when the admin role holds every required permission', () => {
    withMetadata(['admins.read']);
    const user = { role: { permissions: ['admins.read', 'roles.read'] } };
    expect(guard.canActivate(contextFor(user))).toBe(true);
  });

  it("allows any permission via the '*' wildcard", () => {
    withMetadata(['admins.delete']);
    const user = { role: { permissions: ['*'] } };
    expect(guard.canActivate(contextFor(user))).toBe(true);
  });

  it('throws 403 when a required permission is missing', () => {
    withMetadata(['admins.delete']);
    const user = { role: { permissions: ['admins.read'] } };
    expect(() => guard.canActivate(contextFor(user))).toThrow(
      ForbiddenException,
    );
  });

  it('throws 403 when there is no user on the request', () => {
    withMetadata(['admins.read']);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });

  describe('tenant scope', () => {
    it('reads permissions off the tenant role (single source of truth) and allows a match', () => {
      withMetadata(['staff.read'], true);
      const user = { role: { permissions: ['staff.read'] } };
      expect(guard.canActivate(contextFor(user))).toBe(true);
    });

    it("honors the tenant wildcard '*'", () => {
      withMetadata(['staff.invite'], true);
      const user = { role: { permissions: ['*'] } };
      expect(guard.canActivate(contextFor(user))).toBe(true);
    });

    it('throws 403 when the tenant user lacks the permission', () => {
      withMetadata(['staff.invite'], true);
      const user = { role: { permissions: ['staff.read'] } };
      expect(() => guard.canActivate(contextFor(user))).toThrow(
        ForbiddenException,
      );
    });
  });
});
