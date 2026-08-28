import {
  CreateDateColumn,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Stay } from '../tenant-stays/stay.entity';
import { Announcement } from './announcement.entity';

/**
 * Lazy per-stay read receipts (spec note 1): a row appears the first time a
 * stay opens an announcement. Aggregate-only surface (19.3 AC3) — never
 * listed per guest. Unique per (announcement, stay) so mark-read is
 * idempotent at the constraint level.
 */
@Entity('announcement_reads')
@Unique('UQ_announcement_reads_announcement_stay', ['announcementId', 'stayId'])
@Index('IDX_announcement_reads_stay', ['stayId'])
export class AnnouncementRead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  announcementId: string;

  @ManyToOne(() => Announcement)
  @JoinColumn({ name: 'announcementId' })
  announcement: Announcement;

  @Column('uuid')
  stayId: string;

  @ManyToOne(() => Stay)
  @JoinColumn({ name: 'stayId' })
  stay: Stay;

  @CreateDateColumn()
  readAt: Date;
}
