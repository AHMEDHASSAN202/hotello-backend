import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';
import { SUBSCRIPTION_EXEMPT_KEY } from '../decorators/subscription-exempt.decorator';
import { TENANT_SCOPE_KEY } from '../decorators/tenant-scope.decorator';
import { TenantAccessService } from '../../modules/tenant-access/tenant-access.service';
import { TenantAccessGuard } from './tenant-access.guard';

describe('TenantAccessGuard (8.6)', () => {
  let guard: TenantAccessGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let access: { getAccessState: jest.Mock };

  const meta = (o: {
    tenantScope?: boolean;
    isPublic?: boolean;
    requireModule?: string;
    exempt?: boolean;
  }) =>
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === TENANT_SCOPE_KEY) return o.tenantScope ?? false;
      if (key === IS_PUBLIC_KEY) return o.isPublic ?? false;
      if (key === REQUIRE_MODULE_KEY) return o.requireModule;
      if (key === SUBSCRIPTION_EXEMPT_KEY) return o.exempt ?? false;
      return undefined;
    });

  const ctx = (method: string, hotelId?: string): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ method, user: hotelId ? { hotelId } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  const state = (o: Partial<ReturnType<typeof baseState>> = {}) => ({
    ...baseState(),
    ...o,
  });
  const baseState = () => ({
    hotelStatus: 'active',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    enabledModules: ['transportation'],
    planNameEn: 'Pro',
    planNameAr: 'برو',
    trialDaysRemaining: null,
    readOnly: false,
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    access = { getAccessState: jest.fn() };
    guard = new TenantAccessGuard(
      reflector as unknown as Reflector,
      access as unknown as TenantAccessService,
    );
  });

  it('is a no-op for non-tenant (admin) routes', async () => {
    meta({ tenantScope: false });
    await expect(guard.canActivate(ctx('POST', 'hotel-1'))).resolves.toBe(true);
    expect(access.getAccessState).not.toHaveBeenCalled();
  });

  it('is a no-op for public tenant routes (login)', async () => {
    meta({ tenantScope: true, isPublic: true });
    await expect(guard.canActivate(ctx('POST'))).resolves.toBe(true);
    expect(access.getAccessState).not.toHaveBeenCalled();
  });

  it('allows GET reads under read-only', async () => {
    meta({ tenantScope: true });
    access.getAccessState.mockResolvedValue(state({ readOnly: true, subscriptionStatus: 'expired' }));
    await expect(guard.canActivate(ctx('GET', 'hotel-1'))).resolves.toBe(true);
  });

  it('blocks mutations under read-only with SUBSCRIPTION_READ_ONLY', async () => {
    meta({ tenantScope: true });
    access.getAccessState.mockResolvedValue(state({ readOnly: true, subscriptionStatus: 'expired' }));
    await expect(guard.canActivate(ctx('POST', 'hotel-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows exempt mutations (auth/profile) under read-only', async () => {
    meta({ tenantScope: true, exempt: true });
    access.getAccessState.mockResolvedValue(state({ readOnly: true }));
    await expect(guard.canActivate(ctx('PATCH', 'hotel-1'))).resolves.toBe(true);
  });

  it('allows mutations while active/trial', async () => {
    meta({ tenantScope: true });
    access.getAccessState.mockResolvedValue(state({ subscriptionStatus: 'trial', readOnly: false }));
    await expect(guard.canActivate(ctx('POST', 'hotel-1'))).resolves.toBe(true);
  });

  it('blocks a suspended hotel with HOTEL_SUSPENDED', async () => {
    meta({ tenantScope: true });
    access.getAccessState.mockResolvedValue(state({ hotelStatus: 'suspended' }));
    await expect(guard.canActivate(ctx('GET', 'hotel-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows a route whose required module is enabled', async () => {
    meta({ tenantScope: true, requireModule: 'transportation' });
    access.getAccessState.mockResolvedValue(state());
    await expect(guard.canActivate(ctx('GET', 'hotel-1'))).resolves.toBe(true);
  });

  it('blocks a route whose required module is not in the plan', async () => {
    meta({ tenantScope: true, requireModule: 'analytics' });
    access.getAccessState.mockResolvedValue(state());
    await expect(guard.canActivate(ctx('GET', 'hotel-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
