import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TenantUrlsService } from './tenant-urls.service';

describe('TenantUrlsService', () => {
  let service: TenantUrlsService;
  let config: { get: jest.Mock };

  beforeEach(async () => {
    config = {
      get: jest.fn((key: string, def?: string) => {
        if (key === 'GUEST_APP_BASE_URL') return 'https://guest.gxp.example';
        if (key === 'TENANT_BASE_DOMAIN') return 'gxp.example';
        return def;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantUrlsService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(TenantUrlsService);
  });

  describe('buildGuestUrl (11.5)', () => {
    it('AC4 — general URL is GUEST_APP_BASE_URL/{slug} with no query', () => {
      expect(service.buildGuestUrl('sunrise')).toBe(
        'https://guest.gxp.example/sunrise',
      );
    });

    it('AC4 — room URL appends ?room={number} URL-encoded ("101A" and "10-B" safe)', () => {
      expect(service.buildGuestUrl('sunrise', { room: '101A' })).toBe(
        'https://guest.gxp.example/sunrise?room=101A',
      );
      expect(service.buildGuestUrl('sunrise', { room: '10-B' })).toBe(
        'https://guest.gxp.example/sunrise?room=10-B',
      );
    });

    it('AC4 — deterministic: same slug+number → identical string (regeneration-safe)', () => {
      const a = service.buildGuestUrl('sunrise', { room: '101' });
      const b = service.buildGuestUrl('sunrise', { room: '101' });
      expect(a).toBe(b);
    });

    it('AC5 — arbitrary params supported (location=pool-bar) for the F&B epic', () => {
      expect(
        service.buildGuestUrl('sunrise', { location: 'pool-bar' }),
      ).toBe('https://guest.gxp.example/sunrise?location=pool-bar');
    });

    it('strips a trailing slash from GUEST_APP_BASE_URL before appending the slug', () => {
      config.get.mockImplementation((key: string, def?: string) => {
        if (key === 'GUEST_APP_BASE_URL') return 'https://guest.gxp.example/';
        return def;
      });
      expect(service.buildGuestUrl('sunrise')).toBe(
        'https://guest.gxp.example/sunrise',
      );
    });
  });
});
