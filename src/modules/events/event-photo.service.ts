import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RenditionService } from '../renditions/rendition.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { Event } from './event.entity';
import { EVENTS_PHOTO_PRESET, EventPhotoKeys } from './events.constants';
import { EventManageView, TenantEventsService } from './tenant-events.service';

export const EVENT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** No SVG — photos only; served bytes are always re-encoded WebP. */
export const EVENT_PHOTO_MIME_TYPES: Record<string, true> = {
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
 * Story 21.2/21.1 AC1 — event cover photo: server-side resize to two
 * renditions (list thumb / detail) via the shared `RenditionService`,
 * immutable uuid keys under `events/`, storage-driver backed. Mirrors
 * `FnbPhotoService`/`HotelInfoPhotoService`.
 *
 * Unlike `TenantEventsService.update()`, this service does NOT check
 * `event.status` — it doesn't call `assertEditable`, so photo changes are
 * currently allowed at any status, including `completed`/`cancelled`. This
 * task only ever produces `draft` events, so the gap is unreachable today;
 * whether photo edits should lock on completed/cancelled events (the AC2
 * safe-edit matrix says published allows photo edits, but is silent on the
 * terminal statuses) is an explicit decision left for Task 6, which
 * introduces those transitions.
 */
@Injectable()
export class EventPhotoService {
  constructor(
    @InjectRepository(Event)
    private readonly eventsRepo: Repository<Event>,
    private readonly renditions: RenditionService,
    private readonly events: TenantEventsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async setPhoto(
    user: TenantUser,
    eventId: string,
    file: UploadedPhoto | undefined,
  ): Promise<EventManageView> {
    if (!file || !EVENT_PHOTO_MIME_TYPES[file.mimetype]) {
      throw new BadRequestException({
        code: 'EVENT_PHOTO_INVALID',
        message: 'Upload a PNG, JPEG or WebP image (max 5 MB)',
      });
    }
    const event = await this.events.findEvent(user.hotelId, eventId);

    let stored: Record<string, string>;
    try {
      stored = await this.renditions.store(
        user.hotelId,
        'events',
        [event.id],
        EVENTS_PHOTO_PRESET,
        file.buffer,
      );
    } catch {
      throw new BadRequestException({
        code: 'EVENT_PHOTO_INVALID',
        message: 'The uploaded file could not be read as an image',
      });
    }
    const keys: EventPhotoKeys = { thumb: stored.thumb, detail: stored.detail };

    const old = event.photoKeys;
    event.photoKeys = keys;
    await this.eventsRepo.save(event);
    await this.deleteQuietly(old);

    await this.auditLogs.log({
      action: 'event.photo_updated',
      entityType: 'event',
      entityId: event.id,
      actorId: user.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: user.hotelId,
        diff: { photo: { from: old?.thumb ?? null, to: keys.thumb } },
      },
    });
    return this.events.toManageView(event);
  }

  async removePhoto(user: TenantUser, eventId: string): Promise<EventManageView> {
    const event = await this.events.findEvent(user.hotelId, eventId);
    const old = event.photoKeys;
    if (old) {
      event.photoKeys = null;
      await this.eventsRepo.save(event);
      await this.deleteQuietly(old);
      await this.auditLogs.log({
        action: 'event.photo_updated',
        entityType: 'event',
        entityId: event.id,
        actorId: user.id,
        metadata: {
          actorType: 'tenant_user',
          hotelId: user.hotelId,
          diff: { photo: { from: old.thumb, to: null } },
        },
      });
    }
    return this.events.toManageView(event);
  }

  /** Best-effort cleanup — a missing object never fails the mutation. */
  private async deleteQuietly(keys: EventPhotoKeys | null): Promise<void> {
    await this.renditions.deleteQuietly(Object.values(keys ?? {}));
  }
}
