import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../common/transformers/decimal.transformer';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';
import { StayType } from '../tenant-stays/stays.constants';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { EventPhotoKeys, EventStatus } from './events.constants';

/**
 * Epic 21 — Events & Workshops. One row per event; `titles`/`descriptions`
 * are 7-locale maps (EN fallback via `localizeField`, the Announcements/F&B
 * convention). `startAtLocal`/`endAtLocal` are hotel-local
 * 'YYYY-MM-DD HH:MM' strings, string-comparable against `hotelLocalStamp()`
 * (the `isStayOverdue` precedent) — never converted to UTC.
 *
 * `includedFor` is **two-state only**: `[]` = paid for everyone, non-empty =
 * included for those stay types. Unlike F&B menu items there is no parent
 * menu default to inherit, so there is no null/"inherit" third state.
 *
 * Events are never hard-deleted — `cancelled`/`completed` are terminal
 * statuses, not deletions (repo-wide "no hard deletes" rule).
 */
@Entity('events')
@Index('IDX_events_hotel_status', ['hotelId', 'status'])
@Index('IDX_events_hotel_start', ['hotelId', 'startAtLocal'])
export class Event {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  titles: TranslationMap;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  descriptions: TranslationMap;

  @Column({ type: 'jsonb', nullable: true })
  photoKeys: EventPhotoKeys | null;

  /** Hotel-local 'YYYY-MM-DD HH:MM' (the `Announcement.publishAtLocal` convention). */
  @Column({ type: 'varchar', length: 16 })
  startAtLocal: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  endAtLocal: string | null;

  @Column({ type: 'varchar', length: 200 })
  locationText: string;

  /** Optional "details in Hotel Info" deep-link chip (the Announcements precedent). */
  @Column({ type: 'uuid', nullable: true })
  infoEntryId: string | null;

  @ManyToOne(() => HotelInfoEntry, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'infoEntryId' })
  infoEntry: HotelInfoEntry | null;

  /** Null = unlimited attendance. */
  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: new ColumnNumericTransformer(),
  })
  price: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  includedFor: StayType[];

  @Column({ length: 12, default: 'draft' })
  status: EventStatus;

  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => TenantUser)
  @JoinColumn({ name: 'createdById' })
  createdBy: TenantUser;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'cancelledById' })
  cancelledBy: TenantUser | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
