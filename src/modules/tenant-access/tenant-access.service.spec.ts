import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { Subscription } from '../subscriptions/subscription.entity';
import { TenantAccessService } from './tenant-access.service';

describe('TenantAccessService (8.6)', () => {
  let service: TenantAccessService;
  let hotelsRepo: { findOne: jest.Mock };
  let subsRepo: { findOne: jest.Mock };

  const hotel = (o: Partial<Hotel> = {}): Hotel =>
    ({ id: 'hotel-1', slug: 'sunrise', status: 'active', nameEn: 'Sunrise', nameAr: 'شروق', logoPath: null, defaultLanguage: 'ar', ...o }) as Hotel;

  const sub = (o: Partial<Subscription> = {}): Subscription =>
    ({
      status: 'active',
      trialEndsAt: null,
      plan: { enabledModules: ['transportation'], nameEn: 'Pro', nameAr: 'برو' },
      ...o,
    }) as Subscription;

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(hotel()) };
    subsRepo = { findOne: jest.fn().mockResolvedValue(sub()) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantAccessService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(Subscription), useValue: subsRepo },
        { provide: ConfigService, useValue: { get: (_k: string, d: string) => d } },
      ],
    }).compile();
    service = moduleRef.get(TenantAccessService);
  });

  it('derives an active, writable state', async () => {
    const state = await service.getAccessState('hotel-1');
    expect(state).toMatchObject({
      hotelStatus: 'active',
      subscriptionStatus: 'active',
      readOnly: false,
      enabledModules: ['transportation'],
    });
  });

  it('marks expired subscriptions read-only', async () => {
    subsRepo.findOne.mockResolvedValue(sub({ status: 'expired' }));
    expect((await service.getAccessState('hotel-1')).readOnly).toBe(true);
  });

  it('marks canceled subscriptions read-only', async () => {
    subsRepo.findOne.mockResolvedValue(sub({ status: 'canceled' }));
    expect((await service.getAccessState('hotel-1')).readOnly).toBe(true);
  });

  it('computes trial days remaining', async () => {
    const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    subsRepo.findOne.mockResolvedValue(sub({ status: 'trial', trialEndsAt }));
    const state = await service.getAccessState('hotel-1');
    expect(state.trialDaysRemaining).toBe(3);
    expect(state.readOnly).toBe(false);
  });

  it('caches within the TTL (a second call hits no repo)', async () => {
    await service.getAccessState('hotel-1');
    await service.getAccessState('hotel-1');
    expect(hotelsRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('re-queries after invalidate()', async () => {
    await service.getAccessState('hotel-1');
    service.invalidate('hotel-1');
    await service.getAccessState('hotel-1');
    expect(hotelsRepo.findOne).toHaveBeenCalledTimes(2);
  });

  describe('getPublicContext (8.1)', () => {
    it('returns branding for a known hotel', async () => {
      const ctx = await service.getPublicContext('sunrise');
      expect(ctx).toMatchObject({ slug: 'sunrise', status: 'active', nameEn: 'Sunrise' });
    });

    it('resolves a suspended hotel (for the lock page)', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel({ status: 'suspended' }));
      expect((await service.getPublicContext('sunrise')).status).toBe('suspended');
    });

    it('404s an unknown slug', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(service.getPublicContext('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s an inactive hotel', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel({ status: 'inactive' }));
      await expect(service.getPublicContext('sunrise')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('exposes the logo as a files path when present', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel({ logoPath: 'logos/x.png' }));
      expect((await service.getPublicContext('sunrise')).logoUrl).toBe(
        'files/logos/x.png',
      );
    });
  });
});
