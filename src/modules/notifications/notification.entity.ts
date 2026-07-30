import { Exclude } from 'class-transformer';
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
import { Hotel } from '../hotels/hotel.entity';
import {
  NotificationChannel,
  NotificationLanguage,
  NotificationStatus,
  NotificationType,
} from './notifications.constants';

/** One delivery attempt — powers the Story 6.7 AC3 timeline. */
export interface DeliveryAttempt {
  at: string;
  ok: boolean;
  error: string | null;
}

/**
 * Story 6.1 — the outbox. Every notification is persisted here *before* any
 * send attempt and tracked through pending → sent | failed. Append-only
 * history: no delete endpoints exist.
 */
@Entity('notification_outbox')
@Index(['status', 'nextAttemptAt'])
@Index(['hotelId', 'createdAt'])
@Index(['createdAt'])
export class NotificationOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  type: NotificationType;

  @Column({ default: 'email' })
  channel: NotificationChannel;

  @Column()
  recipientName: string;

  @Column()
  recipientEmail: string;

  @Column({ type: 'uuid', nullable: true })
  hotelId: string | null;

  @ManyToOne(() => Hotel, { nullable: true })
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel | null;

  @Column({ type: 'uuid', nullable: true })
  tenantUserId: string | null;

  @Column()
  language: NotificationLanguage;

  /** Rendered at queue time; masked for setup links (Story 6.4 AC2). */
  @Column({ type: 'text' })
  subject: string;

  @Column({ type: 'text' })
  bodyHtml: string;

  /**
   * Non-secret template variables — enable re-render on resend. Never
   * contains raw tokens or URLs embedding them. Internal: excluded from
   * serialization (API responses are shaped in the service anyway).
   */
  @Exclude()
  @Column({ type: 'jsonb', nullable: true })
  variables: Record<string, unknown> | null;

  /**
   * Story 6.1 AC4 — deterministic per event occurrence; the unique index
   * makes duplicate processing a no-op. Null for resends (NULLs are distinct).
   * Excluded: embeds a hash prefix of the setup token for setup links.
   */
  @Exclude()
  @Index({ unique: true })
  @Column({ type: 'text', nullable: true })
  dedupeKey: string | null;

  @Column({ default: 'pending' })
  status: NotificationStatus;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  attempts: DeliveryAttempt[];

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** Story 6.7 AC4 — a resend references the record it replaces. */
  @Column({ type: 'uuid', nullable: true })
  resendOfId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
