import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { GuestProfileService } from './guest-profile.service';

const makeHotel = (o: Record<string, unknown> = {}) =>
  ({
    id: 'hotel-1',
    slug: 'sunrise',
    status: 'active',
    nameEn: 'Sunrise',
    nameAr: 'شروق',
    logoPath: 'hotels/hotel-1/logo-1.png',
    brandAccentColor: '#7A2E2E',
    checkoutTime: '12:00',
    timezone: 'Africa/Cairo',
    defaultLanguage: 'ar',
    currency: 'EGP',
    ...o,
  }) as unknown as Hotel;

const makeAccessState = (o: Record<string, unknown> = {}) => ({
  hotelStatus: 'active',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  enabledModules: ['requests', 'fnb', 'guest_app_branding'],
  planNameEn: 'Pro',
  planNameAr: 'برو',
  trialDaysRemaining: null,
  readOnly: false,
  ...o,
});

describe('GuestProfileService — getProfile (14.4 AC1/AC5)', () => {
  let service: GuestProfileService;
  let hotelsRepo: { findOne: jest.Mock };
  let tenantAccess: { getAccessState: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(makeHotel()) };
    tenantAccess = {
      getAccessState: jest.fn().mockResolvedValue(makeAccessState()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestProfileService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: TenantAccessService, useValue: tenantAccess },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_k: string, fallback: number) => fallback),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(GuestProfileService);
  });

  it('returns the full guest-appropriate profile for an active hotel', async () => {
    const profile = await service.getProfile('sunrise');
    expect(profile).toEqual({
      slug: 'sunrise',
      nameEn: 'Sunrise',
      nameAr: 'شروق',
      logoUrl: 'files/hotels/hotel-1/logo-1.png',
      status: 'active',
      brandAccentColor: '#7A2E2E',
      checkoutTime: '12:00',
      timezone: 'Africa/Cairo',
      defaultLanguage: 'ar',
      // Epic 16 — the Guest App formats menu prices in the hotel currency.
      currency: 'EGP',
      enabledModules: ['requests', 'fnb', 'guest_app_branding'],
    });
  });

  it('nulls the accent color when the plan lacks guest_app_branding', async () => {
    tenantAccess.getAccessState.mockResolvedValue(
      makeAccessState({ enabledModules: ['requests'] }),
    );
    const profile = await service.getProfile('sunrise');
    expect(profile.brandAccentColor).toBeNull();
  });

  it('returns a null logoUrl when the hotel has no logo', async () => {
    hotelsRepo.findOne.mockResolvedValue(makeHotel({ logoPath: null }));
    const profile = await service.getProfile('sunrise');
    expect(profile.logoUrl).toBeNull();
  });

  it('resolves a suspended hotel as unavailable instead of throwing', async () => {
    hotelsRepo.findOne.mockResolvedValue(makeHotel({ status: 'suspended' }));
    const profile = await service.getProfile('sunrise');
    expect(profile.status).toBe('unavailable');
    expect(profile.nameEn).toBe('Sunrise');
  });

  it('resolves an expired/canceled (read-only) subscription as unavailable', async () => {
    tenantAccess.getAccessState.mockResolvedValue(
      makeAccessState({ subscriptionStatus: 'expired', readOnly: true }),
    );
    const profile = await service.getProfile('sunrise');
    expect(profile.status).toBe('unavailable');
  });

  it('404s with HOTEL_NOT_FOUND for an unknown slug', async () => {
    hotelsRepo.findOne.mockResolvedValue(null);
    await expect(service.getProfile('nope')).rejects.toMatchObject({
      constructor: NotFoundException,
      response: { code: 'HOTEL_NOT_FOUND' },
    });
  });

  it('404s for an inactive hotel — indistinguishable from unknown', async () => {
    hotelsRepo.findOne.mockResolvedValue(makeHotel({ status: 'inactive' }));
    await expect(service.getProfile('sunrise')).rejects.toMatchObject({
      response: { code: 'HOTEL_NOT_FOUND' },
    });
  });

  it('lowercases the slug before lookup (QR URLs are case-insensitive)', async () => {
    await service.getProfile('SunRise');
    expect(hotelsRepo.findOne).toHaveBeenCalledWith({
      where: { slug: 'sunrise' },
    });
  });

  it('serves from cache within the TTL — no repo or access-state hit', async () => {
    await service.getProfile('sunrise');
    await service.getProfile('sunrise');
    expect(hotelsRepo.findOne).toHaveBeenCalledTimes(1);
    expect(tenantAccess.getAccessState).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has elapsed', async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      await service.getProfile('sunrise');
      jest.advanceTimersByTime(61_000);
      await service.getProfile('sunrise');
      expect(hotelsRepo.findOne).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not cache 404s under a different slug entry', async () => {
    hotelsRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.getProfile('ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // A hotel appearing under that slug later is served fresh.
    hotelsRepo.findOne.mockResolvedValue(makeHotel({ slug: 'ghost' }));
    const profile = await service.getProfile('ghost');
    expect(profile.slug).toBe('ghost');
  });
});
