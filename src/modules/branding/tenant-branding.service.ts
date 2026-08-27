import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';
import { GuestLanguage } from '../tenant-stays/stays.constants';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.interface';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  BRANDING_COVER_MIME_TYPES,
  BrandingManageView,
  COVER_DETAIL,
  COVER_THUMB,
} from './branding.constants';
import { isAccentAllowed, nearestSafeAccent } from './contrast.util';
import { UpdateBrandingDto } from './dto/update-branding.dto';

interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const WELCOME_FIELDS: Array<[keyof UpdateBrandingDto, GuestLanguage]> = [
  ['welcomeAr', 'ar'],
  ['welcomeEn', 'en'],
  ['welcomeRu', 'ru'],
  ['welcomeFr', 'fr'],
  ['welcomeIt', 'it'],
  ['welcomeEs', 'es'],
  ['welcomeDe', 'de'],
];

/**
 * Guest App branding knobs (Epic 18) — stored as hotel columns per the
 * small-settings precedent. Values persist when the module is off; the guest
 * profile endpoint owns the module gating (18.2 AC1).
 */
@Injectable()
export class TenantBrandingService {
  private readonly logger = new Logger(TenantBrandingService.name);

  constructor(
    @InjectRepository(Hotel) private readonly hotels: Repository<Hotel>,
    private readonly auditLogs: AuditLogsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async getBranding(user: TenantUser): Promise<BrandingManageView> {
    const hotel = await this.loadHotel(user);
    return this.toView(hotel);
  }

  async updateBranding(user: TenantUser, dto: UpdateBrandingDto): Promise<BrandingManageView> {
    const hotel = await this.loadHotel(user);
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (dto.brandAccentColor !== undefined) {
      const next = dto.brandAccentColor === '' ? null : dto.brandAccentColor;
      if (next && !isAccentAllowed(next)) {
        throw new BadRequestException({
          code: 'BRANDING_ACCENT_CONTRAST',
          message: 'Accent color fails the 3:1 contrast requirement.',
          suggestion: nearestSafeAccent(next),
        });
      }
      if (next !== hotel.brandAccentColor) {
        diff.brandAccentColor = { from: hotel.brandAccentColor, to: next };
        hotel.brandAccentColor = next;
      }
    }

    if (WELCOME_FIELDS.some(([field]) => dto[field] !== undefined)) {
      const next = this.mergeWelcome(dto, hotel.welcomeMessage);
      if (JSON.stringify(next) !== JSON.stringify(hotel.welcomeMessage)) {
        diff.welcomeMessage = { from: hotel.welcomeMessage, to: next };
        hotel.welcomeMessage = next;
      }
    }

    if (Object.keys(diff).length === 0) return this.toView(hotel);
    await this.hotels.save(hotel);
    await this.audit(user, diff);
    return this.toView(hotel);
  }

  async setCover(user: TenantUser, file: UploadedPhoto | undefined): Promise<BrandingManageView> {
    if (!file) {
      throw new BadRequestException({
        code: 'BRANDING_COVER_REQUIRED',
        message: 'Cover image file is required.',
      });
    }
    if (!BRANDING_COVER_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({
        code: 'BRANDING_COVER_INVALID',
        message: 'Cover must be a PNG, JPEG, or WebP image.',
      });
    }
    const hotel = await this.loadHotel(user);
    const [thumb, detail] = await Promise.all([
      sharp(file.buffer)
        .rotate()
        .resize(COVER_THUMB.width, COVER_THUMB.height, { fit: 'cover' })
        .webp({ quality: 82 })
        .toBuffer(),
      sharp(file.buffer)
        .rotate()
        .resize(COVER_DETAIL.width, COVER_DETAIL.height, { fit: 'cover' })
        .webp({ quality: 82 })
        .toBuffer(),
    ]).catch(() => {
      throw new BadRequestException({
        code: 'BRANDING_COVER_INVALID',
        message: 'Cover image could not be processed.',
      });
    });
    const base = `branding/${user.hotelId}/${randomUUID()}`;
    const thumbKey = `${base}-thumb.webp`;
    const detailKey = `${base}-detail.webp`;
    await this.storage.put(thumbKey, thumb, 'image/webp');
    await this.storage.put(detailKey, detail, 'image/webp');
    const oldKeys = [hotel.coverImageThumbKey, hotel.coverImageDetailKey];
    hotel.coverImageThumbKey = thumbKey;
    hotel.coverImageDetailKey = detailKey;
    await this.hotels.save(hotel);
    await this.deleteQuietly(oldKeys);
    await this.audit(user, { coverImage: { changed: true } });
    return this.toView(hotel);
  }

  async removeCover(user: TenantUser): Promise<BrandingManageView> {
    const hotel = await this.loadHotel(user);
    if (!hotel.coverImageThumbKey && !hotel.coverImageDetailKey) return this.toView(hotel);
    const oldKeys = [hotel.coverImageThumbKey, hotel.coverImageDetailKey];
    hotel.coverImageThumbKey = null;
    hotel.coverImageDetailKey = null;
    await this.hotels.save(hotel);
    await this.deleteQuietly(oldKeys);
    await this.audit(user, { coverImage: { removed: true } });
    return this.toView(hotel);
  }

  private async deleteQuietly(keys: Array<string | null>): Promise<void> {
    for (const key of keys) {
      if (!key) continue;
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.warn(`Failed to delete stale cover rendition ${key}: ${String(err)}`);
      }
    }
  }

  private mergeWelcome(
    dto: UpdateBrandingDto,
    existing: TranslationMap | null,
  ): TranslationMap | null {
    const next: TranslationMap = { ...(existing ?? {}) };
    for (const [field, lang] of WELCOME_FIELDS) {
      const value = dto[field];
      if (value === undefined) continue;
      const trimmed = String(value).trim();
      if (trimmed) next[lang] = trimmed;
      else delete next[lang];
    }
    if (Object.keys(next).length === 0) return null;
    if (!next.ar || !next.en) {
      throw new BadRequestException({
        code: 'BRANDING_WELCOME_REQUIRED',
        message: 'Welcome message requires Arabic and English.',
      });
    }
    return next;
  }

  private async loadHotel(user: TenantUser): Promise<Hotel> {
    // hotelId comes from the JWT; the row always exists for an authenticated tenant user.
    return (await this.hotels.findOne({ where: { id: user.hotelId } })) as Hotel;
  }

  private toView(hotel: Hotel): BrandingManageView {
    return {
      brandAccentColor: hotel.brandAccentColor,
      coverThumbUrl: hotel.coverImageThumbKey ? `files/${hotel.coverImageThumbKey}` : null,
      coverDetailUrl: hotel.coverImageDetailKey ? `files/${hotel.coverImageDetailKey}` : null,
      welcomeMessage: hotel.welcomeMessage,
    };
  }

  private async audit(user: TenantUser, diff: Record<string, unknown>): Promise<void> {
    await this.auditLogs.log({
      action: 'branding.updated',
      entityType: 'hotel',
      entityId: user.hotelId,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId, diff },
    });
  }
}
