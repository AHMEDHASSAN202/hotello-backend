import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsService } from '../hotels/tenant-urls.service';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.interface';
import { PdfRendererService } from '../tenant-rooms/pdf/pdf-renderer.service';
import { expandRange } from '../tenant-rooms/room-rows';
import { RoomQrService } from '../tenant-rooms/room-qr.service';
import { StickerPdfQueryDto } from './dto/fnb-location.dto';
import { FnbLocation } from './fnb-location.entity';
import { stickerTemplate, StickerData } from './pdf/fnb-sticker.template';
import { TenantFnbLocationsService } from './tenant-fnb-locations.service';

/**
 * Epic 16, Story 16.3 AC2 — location QR sticker PDFs, reusing the Epic 11
 * machinery wholesale: `expandRange` for the numbered series, RoomQrService
 * data-URIs, the shared Playwright renderer. GET-only like the room PDFs —
 * printing keeps working for read-only (expired-trial) hotels.
 */
@Injectable()
export class FnbStickerPdfService {
  constructor(
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly locations: TenantFnbLocationsService,
    private readonly qr: RoomQrService,
    private readonly renderer: PdfRendererService,
    private readonly tenantUrls: TenantUrlsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async generateStickers(
    hotelId: string,
    locationId: string,
    query: StickerPdfQueryDto,
  ): Promise<Buffer> {
    const [hotel, location] = await Promise.all([
      this.loadHotel(hotelId),
      this.locations.findLocation(hotelId, locationId),
    ]);

    const spots = this.resolveSpots(location, query);
    const stickers: StickerData[] = await Promise.all(
      spots.map(async (spot) => ({
        spot,
        qrDataUri: await this.qr.toDataUrl(
          this.tenantUrls.buildGuestUrl(hotel.slug, {
            location: location.key,
            ...(spot !== null ? { spot } : {}),
          }),
        ),
      })),
    );

    const html = stickerTemplate({
      hotelNameEn: hotel.nameEn,
      hotelNameAr: hotel.nameAr,
      logoDataUri: await this.loadLogoDataUri(hotel),
      locationNameEn: location.names.en ?? '',
      locationNameAr: location.names.ar ?? '',
      spotLabelEn: location.spotLabel?.en ?? null,
      spotLabelAr: location.spotLabel?.ar ?? null,
      stickers,
    });
    return this.renderer.render(html, { format: 'A4' });
  }

  /** Viewable/copyable location QR (16.3 AC2) — PNG or SVG, optional spot. */
  async locationQr(
    hotelId: string,
    locationId: string,
    format: 'png' | 'svg',
    spot?: string,
  ): Promise<{ body: Buffer | string; contentType: string; key: string }> {
    const [hotel, location] = await Promise.all([
      this.loadHotel(hotelId),
      this.locations.findLocation(hotelId, locationId),
    ]);
    if (spot && !location.hasSpots) {
      throw new BadRequestException({
        code: 'FNB_LOCATION_NO_SPOTS',
        message: 'This location has no numbered spots',
      });
    }
    const url = this.tenantUrls.buildGuestUrl(hotel.slug, {
      location: location.key,
      ...(spot ? { spot } : {}),
    });
    const { body, contentType } = await this.qr.generate(url, format);
    return { body, contentType, key: location.key };
  }

  /** No range → one zone sticker; a range → the numbered series (AC2/AC3). */
  private resolveSpots(
    location: FnbLocation,
    query: StickerPdfQueryDto,
  ): Array<string | null> {
    const hasRange = query.from !== undefined || query.to !== undefined;
    if (!hasRange) return [null];
    if (query.from === undefined || query.to === undefined) {
      throw new BadRequestException({
        code: 'FNB_STICKER_RANGE_INVALID',
        message: 'A numbered series needs both from and to',
      });
    }
    if (!location.hasSpots) {
      throw new BadRequestException({
        code: 'FNB_LOCATION_NO_SPOTS',
        message: 'This location has no numbered spots',
      });
    }
    const exclusions = (query.exclusions ?? '')
      .split(',')
      .filter(Boolean)
      .map((n) => parseInt(n, 10));
    return expandRange({ from: query.from, to: query.to, exclusions });
  }

  private async loadHotel(hotelId: string): Promise<Hotel> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }
    return hotel;
  }

  private async loadLogoDataUri(hotel: Hotel): Promise<string | null> {
    if (!hotel.logoPath) return null;
    try {
      const { data, contentType } = await this.storage.get(hotel.logoPath);
      return `data:${contentType};base64,${data.toString('base64')}`;
    } catch {
      return null;
    }
  }
}
