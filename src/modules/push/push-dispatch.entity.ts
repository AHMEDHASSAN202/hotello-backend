import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeliveryAttempt } from '../notifications/notification.entity';
import { PushDispatchStatus, PushType } from './push.constants';

/**
 * The push outbox (23.1 AC2) — deliberately NOT the email `notification_outbox`:
 * different lifecycle (short TTLs, collapse, quiet-hold), different volume, and
 * 30-day retention vs the email audit trail (spec note 2, recorded decision).
 */
@Entity('push_dispatches')
@Index(['status', 'nextAttemptAt'])
@Index(['hotelId', 'createdAt'])
@Index(['refId'])
export class PushDispatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @Column('uuid')
  stayId: string;

  @Column('uuid')
  subscriptionId: string;

  @Column({ length: 20 })
  type: PushType;

  /** Source record (announcement/request/order/booking/stay id) — stats + collapse. */
  @Column({ type: 'uuid', nullable: true })
  refId: string | null;

  /** Composed at queue time in the guest's language — the SW renders, never composes. */
  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  body: string;

  /** Relative deep link into the guest app, e.g. `/sunrise?open=order:123`. */
  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'int' })
  ttlSeconds: number;

  /** Web Push collapse topic + SW notification tag (23.4 AC3). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  topic: string | null;

  /** Reminder idempotency (23.5) — unique, NULLs distinct (email-outbox pattern). */
  @Exclude()
  @Index({ unique: true })
  @Column({ type: 'text', nullable: true })
  dedupeKey: string | null;

  @Column({ default: 'pending' })
  status: PushDispatchStatus;

  /** Quiet-hours hold (23.3 AC4): when set, dispatch starts at this instant. */
  @Column({ type: 'timestamptz', nullable: true })
  deliverAfter: Date | null;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
