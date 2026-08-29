import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RenditionService } from '../renditions/rendition.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbItem } from './fnb-item.entity';
import { FNB_PHOTO_PRESET, FnbPhotoKeys } from './fnb.constants';
import { TenantFnbMenusService, FnbItemManageView } from './tenant-fnb-menus.service';

export const FNB_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** No SVG — photos only; served bytes are always re-encoded WebP. */
export const FNB_PHOTO_MIME_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/webp': true,
};

interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Epic 16, spec note 6 — item photos: server-side resize to two renditions
 * (list thumb / detail), immutable uuid keys under `fnb/` (files controller
 * serves those with a year-long immutable cache), storage-driver backed.
 * Replacing/removing deletes the old derived objects — they're derived
 * assets, not business records.
 */
@Injectable()
export class FnbPhotoService {
  constructor(
    @InjectRepository(FnbItem)
    private readonly itemsRepo: Repository<FnbItem>,
    private readonly renditions: RenditionService,
    private readonly menus: TenantFnbMenusService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async setPhoto(
    user: TenantUser,
    itemId: string,
    file: UploadedPhoto | undefined,
  ): Promise<FnbItemManageView> {
    if (!file || !FNB_PHOTO_MIME_TYPES[file.mimetype]) {
      throw new BadRequestException({
        code: 'FNB_PHOTO_INVALID',
        message: 'Upload a PNG, JPEG or WebP image (max 5 MB)',
      });
    }
    const item = await this.menus.findItem(user.hotelId, itemId);

    let stored: Record<string, string>;
    try {
      stored = await this.renditions.store(
        user.hotelId,
        'fnb',
        [item.id],
        FNB_PHOTO_PRESET,
        file.buffer,
      );
    } catch {
      throw new BadRequestException({
        code: 'FNB_PHOTO_INVALID',
        message: 'The uploaded file could not be read as an image',
      });
    }
    const keys: FnbPhotoKeys = { thumb: stored.thumb, detail: stored.detail };

    const old = item.photoKeys;
    item.photoKeys = keys;
    await this.itemsRepo.save(item);
    await this.deleteQuietly(old);

    await this.auditLogs.log({
      action: 'fnb_item.photo_updated',
      entityType: 'fnb_item',
      entityId: item.id,
      actorId: user.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: user.hotelId,
        diff: { photo: { from: old?.thumb ?? null, to: keys.thumb } },
      },
    });
    return this.menus.toItemView(item);
  }

  async removePhoto(
    user: TenantUser,
    itemId: string,
  ): Promise<FnbItemManageView> {
    const item = await this.menus.findItem(user.hotelId, itemId);
    const old = item.photoKeys;
    if (old) {
      item.photoKeys = null;
      await this.itemsRepo.save(item);
      await this.deleteQuietly(old);
      await this.auditLogs.log({
        action: 'fnb_item.photo_updated',
        entityType: 'fnb_item',
        entityId: item.id,
        actorId: user.id,
        metadata: {
          actorType: 'tenant_user',
          hotelId: user.hotelId,
          diff: { photo: { from: old.thumb, to: null } },
        },
      });
    }
    return this.menus.toItemView(item);
  }

  /** Best-effort cleanup — a missing object never fails the mutation. */
  private async deleteQuietly(keys: FnbPhotoKeys | null): Promise<void> {
    await this.renditions.deleteQuietly(Object.values(keys ?? {}));
  }
}
