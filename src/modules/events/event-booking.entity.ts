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
import { FnbPaymentMethod } from '../fnb/fnb.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { Event } from './event.entity';
import {
  EventBookingCancelledBy,
  EventBookingSnapshot,
  EventBookingStatus,
} from './events.constants';

/**
 * Epic 21 — a guest's booking for an event. `snapshot` freezes what the
 * guest was shown at booking time (titles/schedule/location) — event edits
 * must never rewrite it, the F&B order-line precedent. `paymentMethod` null
 * means fully included, no payment step (the F&B order convention); it
 * reuses `FnbPaymentMethod` since both read the same hotel-level
 * `roomChargeEnabled` toggle (Story 21.1 AC2).
 */
@Entity('event_bookings')
@Index('IDX_event_bookings_event', ['eventId'])
@Index('IDX_event_bookings_stay', ['stayId'])
@Index('IDX_event_bookings_hotel_status', ['hotelId', 'status'])
export class EventBooking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  /** No cascade delete — events are never hard-deleted. */
  @Column('uuid')
  eventId: string;

  @ManyToOne(() => Event)
  @JoinColumn({ name: 'eventId' })
  event: Event;

  @Column('uuid')
  stayId: string;

  @ManyToOne(() => Stay)
  @JoinColumn({ name: 'stayId' })
  stay: Stay;

  @Column({ type: 'int' })
  partySize: number;

  @Column({ type: 'jsonb' })
  snapshot: EventBookingSnapshot;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  unitPrice: number;

  @Column({ default: false })
  included: boolean;

  /** 0 when `included` — paid total only, the F&B order convention. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: new ColumnNumericTransformer(),
  })
  totalAmount: number;

  @Column({ length: 3 })
  currency: string;

  /** Null = fully-included booking, no payment step. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  paymentMethod: FnbPaymentMethod | null;

  @Column({ length: 10, default: 'booked' })
  status: EventBookingStatus;

  @Column({ type: 'varchar', length: 10, nullable: true })
  cancelledBy: EventBookingCancelledBy | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelledReason: string | null;

  /** Room-charge settlement at checkout; null = not settled (the F&B precedent). */
  @Column({ type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  settledById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
