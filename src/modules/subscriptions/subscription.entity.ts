import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { Plan } from '../plans/plan.entity';

export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus =
  | 'active'
  | 'trial'
  | 'past_due'
  | 'canceled'
  | 'expired';

/**
 * A hotel's current subscription is the row where `endDate IS NULL`.
 * Plan changes close the current row and create a new one — history is
 * preserved as closed rows, never overwritten (SA-SUB-2).
 */
@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column('uuid')
  planId: string;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'planId' })
  plan: Plan;

  @Column()
  billingCycle: BillingCycle;

  @Column()
  status: SubscriptionStatus;

  @Column({ type: 'timestamptz' })
  startDate: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endDate: Date | null;

  /** Null for trials — no renewal is scheduled (SA-SUB-2). */
  @Column({ type: 'timestamptz', nullable: true })
  nextRenewalAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  trialEndsAt: Date | null;

  /** Acting admin snapshot; null when created by the system. */
  @Column({ type: 'uuid', nullable: true })
  changedById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
