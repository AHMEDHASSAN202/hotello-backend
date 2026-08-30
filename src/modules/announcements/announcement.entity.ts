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
import { Event } from '../events/event.entity';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  AnnouncementSource,
  AnnouncementStatus,
  AudienceFilter,
} from './announcements.constants';

/**
 * Epic 19 spec note 1 — one row per announcement; the audience is a JSONB
 * filter evaluated live (19.1 AC3), never a recipient snapshot. Retracted and
 * expired rows stay forever (sent history, 19.2 AC2); reads live in
 * `announcement_reads` and survive retraction.
 */
@Entity('announcements')
@Index('IDX_announcements_hotel_status', ['hotelId', 'status'])
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  /** 7-locale maps, ar+en required (19.1 AC1), EN fallback via localizeField. */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  titles: TranslationMap;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  bodies: TranslationMap;

  /** Optional "details in Hotel Info" deep-link chip (19.1 AC1). */
  @Column({ type: 'uuid', nullable: true })
  infoEntryId: string | null;

  @ManyToOne(() => HotelInfoEntry, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'infoEntryId' })
  infoEntry: HotelInfoEntry | null;

  /** "مهم" — pins to the top of the inbox and the home banner (19.4 AC3). */
  @Column({ default: false })
  priority: boolean;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  audience: AudienceFilter;

  @Column({ length: 12, default: 'draft' })
  status: AnnouncementStatus;

  /** Hotel-local 'YYYY-MM-DD HH:MM' (19.2 AC1); string-comparable. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  publishAtLocal: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  activeUntilLocal: string | null;

  /** UTC instant it actually went live (sent time in history, 19.3 AC1). */
  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiredAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  retractedAt: Date | null;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => TenantUser)
  @JoinColumn({ name: 'createdById' })
  createdBy: TenantUser;

  @Column({ type: 'uuid', nullable: true })
  retractedById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  /** The guest delta cursor — status flips bump it (tombstone deltas). */
  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * 21.3 groundwork — null = manually composed by a tenant user (every
   * pre-existing row); set when Events auto-generates the notice so the
   * tenant UI can badge it "auto · event".
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  source: AnnouncementSource | null;

  @Column({ type: 'uuid', nullable: true })
  eventId: string | null;

  @ManyToOne(() => Event, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'eventId' })
  event: Event | null;
}
