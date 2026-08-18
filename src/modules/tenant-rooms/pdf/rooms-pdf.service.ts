import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../../hotels/hotel.entity';
import { TenantUrlsService } from '../../hotels/tenant-urls.service';
import { STORAGE_DRIVER, StorageDriver } from '../../storage/storage.interface';
import { CardsPdfQueryDto } from '../dto/cards-pdf.dto';
import { RoomQrService } from '../room-qr.service';
import { Room } from '../room.entity';
import { NATURAL_ROOM_ORDER } from '../tenant-rooms.service';
import { CardData, cardsTemplate } from './cards.template';
import { PdfRendererService } from './pdf-renderer.service';
import { posterTemplate } from './poster.template';

/**
 * Story 11.5 AC1/AC2 — generates the two print-ready QR PDFs (reception
 * poster, room cards). Everything is derived on demand and streamed by the
 * controller; nothing here is persisted except the one-time
 * `hotel.qrGeneratedAt` timestamp that drives the tenant setup checklist
 * (`TenantProfileService.me()`). Kept as its own service (not folded into
 * `TenantRoomsService`) — it composes the QR/URL/storage/renderer pieces for
 * a single purpose and would otherwise bloat an already-large file.
 */
@Injectable()
export class RoomsPdfService {
  constructor(
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly renderer: PdfRendererService,
    private readonly roomQrService: RoomQrService,
    private readonly tenantUrls: TenantUrlsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** `GET /tenant/rooms/pdf/poster` — the hotel-wide guest URL as a poster. */
  async generatePoster(hotelId: string, size: 'A4' | 'A5'): Promise<Buffer> {
    const hotel = await this.loadHotel(hotelId);
    const guestUrl = this.tenantUrls.buildGuestUrl(hotel.slug);
    const [qrDataUri, logoDataUri] = await Promise.all([
      this.roomQrService.toDataUrl(guestUrl),
      this.loadLogoDataUri(hotel),
    ]);

    const html = posterTemplate({
      hotelNameEn: hotel.nameEn,
      hotelNameAr: hotel.nameAr,
      logoDataUri,
      qrDataUri,
      size,
    });
    const buffer = await this.renderer.render(html, { format: size });
    await this.markQrGenerated(hotel);
    return buffer;
  }

  /**
   * `GET /tenant/rooms/pdf/cards` — one card per matching room. `inactive`
   * rooms never appear (they've been "removed" per the no-hard-delete
   * convention); zero matches after filtering is a 400, not an empty PDF.
   */
  async generateCards(hotelId: string, query: CardsPdfQueryDto): Promise<Buffer> {
    const [hotel, rooms] = await Promise.all([
      this.loadHotel(hotelId),
      this.roomsForScope(hotelId, query),
    ]);

    if (rooms.length === 0) {
      throw new BadRequestException({
        code: 'NO_ROOMS_IN_SCOPE',
        message: 'No rooms matched the selected scope',
      });
    }

    const logoDataUri = await this.loadLogoDataUri(hotel);
    const cards: CardData[] = await Promise.all(
      rooms.map(async (room) => ({
        roomNumber: room.roomNumber,
        qrDataUri: await this.roomQrService.toDataUrl(
          this.tenantUrls.buildGuestUrl(hotel.slug, { room: room.roomNumber }),
        ),
      })),
    );

    const html = cardsTemplate({
      hotelNameEn: hotel.nameEn,
      hotelNameAr: hotel.nameAr,
      logoDataUri,
      cards,
    });
    const buffer = await this.renderer.render(html, { format: 'A4' });
    await this.markQrGenerated(hotel);
    return buffer;
  }

  /**
   * Isolation (global constraint) — every branch filters by `hotelId` FIRST,
   * so a `roomIds` list containing another tenant's room id simply finds no
   * match here; it's never confirmed or rejected separately, just dropped.
   * `scope: 'floors'`/`'rooms'` with no values selects nothing (the 0-match
   * 400 above is what the caller sees, not a query error).
   */
  private async roomsForScope(hotelId: string, query: CardsPdfQueryDto): Promise<Room[]> {
    if (query.scope === 'floors' && (!query.floors || query.floors.length === 0)) {
      return [];
    }
    if (query.scope === 'rooms' && (!query.roomIds || query.roomIds.length === 0)) {
      return [];
    }

    const qb = this.roomsRepo
      .createQueryBuilder('r')
      .where('r.hotelId = :hotelId', { hotelId })
      .andWhere('r.status != :inactive', { inactive: 'inactive' });

    if (query.scope === 'floors') {
      qb.andWhere('r.floor IN (:...floors)', { floors: query.floors });
    } else if (query.scope === 'rooms') {
      qb.andWhere('r.id IN (:...roomIds)', { roomIds: query.roomIds });
    }

    qb.orderBy('r.floor', 'ASC', 'NULLS LAST')
      .addOrderBy(NATURAL_ROOM_ORDER, 'ASC', 'NULLS LAST')
      .addOrderBy('r.roomNumber', 'ASC');

    return qb.getMany();
  }

  /** Reads the hotel logo through the storage driver; any failure = render without it. */
  private async loadLogoDataUri(hotel: Hotel): Promise<string | null> {
    if (!hotel.logoPath) return null;
    try {
      const { data, contentType } = await this.storage.get(hotel.logoPath);
      return `data:${contentType};base64,${data.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /**
   * `hotel.qrGeneratedAt ??= new Date()` — a single UPDATE on first
   * generation only, never inside a lock (this is a read-derived artifact,
   * not part of any room/seat-count transaction). Drives the "QR generated"
   * setup-checklist step and is never unset.
   */
  private async markQrGenerated(hotel: Hotel): Promise<void> {
    if (hotel.qrGeneratedAt) return;
    await this.hotelsRepo.update({ id: hotel.id }, { qrGeneratedAt: new Date() });
  }

  private async loadHotel(hotelId: string): Promise<Hotel> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) {
      throw new NotFoundException({ code: 'HOTEL_NOT_FOUND', message: 'Hotel not found' });
    }
    return hotel;
  }
}
