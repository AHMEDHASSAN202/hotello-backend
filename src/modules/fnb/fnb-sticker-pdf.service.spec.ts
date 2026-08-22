import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsService } from '../hotels/tenant-urls.service';
import { STORAGE_DRIVER } from '../storage/storage.interface';
import { PdfRendererService } from '../tenant-rooms/pdf/pdf-renderer.service';
import { RoomQrService } from '../tenant-rooms/room-qr.service';
import { FnbLocation } from './fnb-location.entity';
import { FnbStickerPdfService } from './fnb-sticker-pdf.service';
import { TenantFnbLocationsService } from './tenant-fnb-locations.service';

const HOTEL = {
  id: 'hotel-1',
  slug: 'sunrise',
  nameEn: 'Sunrise',
  nameAr: 'شروق',
  logoPath: null,
} as unknown as Hotel;

const makeLocation = (o: Partial<FnbLocation> = {}): FnbLocation =>
  ({
    id: 'loc-1',
    hotelId: 'hotel-1',
    key: 'pool',
    names: { en: 'Pool', ar: 'المسبح' },
    hasSpots: true,
    spotLabel: { en: 'Umbrella', ar: 'شمسية' },
    isActive: true,
    sortOrder: 0,
    ...o,
  }) as FnbLocation;

describe('FnbStickerPdfService (16.3 AC2)', () => {
  let service: FnbStickerPdfService;
  let hotelsRepo: { findOne: jest.Mock };
  let locations: { findLocation: jest.Mock };
  let qr: { toDataUrl: jest.Mock; generate: jest.Mock };
  let renderer: { render: jest.Mock };
  let tenantUrls: { buildGuestUrl: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(HOTEL) };
    locations = { findLocation: jest.fn().mockResolvedValue(makeLocation()) };
    qr = {
      toDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,QR'),
      generate: jest
        .fn()
        .mockResolvedValue({ body: Buffer.from('png'), contentType: 'image/png' }),
    };
    renderer = { render: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    tenantUrls = {
      buildGuestUrl: jest.fn(
        (slug: string, params: Record<string, string> = {}) =>
          `https://guest.example/${slug}?${new URLSearchParams(params)}`,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FnbStickerPdfService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: TenantFnbLocationsService, useValue: locations },
        { provide: RoomQrService, useValue: qr },
        { provide: PdfRendererService, useValue: renderer },
        { provide: TenantUrlsService, useValue: tenantUrls },
        { provide: STORAGE_DRIVER, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(FnbStickerPdfService);
  });

  it('no range → ONE zone sticker without a spot param', async () => {
    await service.generateStickers('hotel-1', 'loc-1', {});
    expect(qr.toDataUrl).toHaveBeenCalledTimes(1);
    expect(tenantUrls.buildGuestUrl).toHaveBeenCalledWith('sunrise', {
      location: 'pool',
    });
    const html = renderer.render.mock.calls[0][0] as string;
    expect(html).toContain('Pool');
    expect(html).toContain('المسبح');
    expect(renderer.render.mock.calls[0][1]).toEqual({ format: 'A4' });
  });

  it('numbered series expands the range, one QR per spot with ?spot=', async () => {
    await service.generateStickers('hotel-1', 'loc-1', {
      from: 1,
      to: 5,
      exclusions: '3',
    } as never);
    expect(qr.toDataUrl).toHaveBeenCalledTimes(4); // 1,2,4,5
    expect(tenantUrls.buildGuestUrl).toHaveBeenCalledWith('sunrise', {
      location: 'pool',
      spot: '2',
    });
    const html = renderer.render.mock.calls[0][0] as string;
    expect(html).toContain('شمسية'); // spot label on the sticker
  });

  it('series on a spotless location → FNB_LOCATION_NO_SPOTS', async () => {
    locations.findLocation.mockResolvedValue(makeLocation({ hasSpots: false }));
    await expect(
      service.generateStickers('hotel-1', 'loc-1', { from: 1, to: 10 } as never),
    ).rejects.toMatchObject({ response: { code: 'FNB_LOCATION_NO_SPOTS' } });
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('half a range → FNB_STICKER_RANGE_INVALID', async () => {
    await expect(
      service.generateStickers('hotel-1', 'loc-1', { from: 1 } as never),
    ).rejects.toMatchObject({ response: { code: 'FNB_STICKER_RANGE_INVALID' } });
  });

  it('locationQr guards spot on spotless locations and returns the key', async () => {
    const res = await service.locationQr('hotel-1', 'loc-1', 'png', '12');
    expect(res.key).toEqual('pool');
    expect(tenantUrls.buildGuestUrl).toHaveBeenCalledWith('sunrise', {
      location: 'pool',
      spot: '12',
    });

    locations.findLocation.mockResolvedValue(makeLocation({ hasSpots: false }));
    await expect(
      service.locationQr('hotel-1', 'loc-1', 'png', '12'),
    ).rejects.toMatchObject({ response: { code: 'FNB_LOCATION_NO_SPOTS' } });
  });
});
