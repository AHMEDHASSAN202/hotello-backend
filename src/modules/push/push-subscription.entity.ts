import { Exclude } from 'class-transformer';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('push_subscriptions')
@Index(['stayId'])
@Index(['hotelId'])
@Index(['tenantUserId'])
@Check('CHK_push_subscriptions_owner', `("stayId" IS NULL) <> ("tenantUserId" IS NULL)`)
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  /** Guest binding (23.2 AC4) — null for staff devices. */
  @Column({ type: 'uuid', nullable: true })
  stayId: string | null;

  /** Epic 26 (26.4 AC1) — staff binding; exactly one of stayId/tenantUserId is set. */
  @Column({ type: 'uuid', nullable: true })
  tenantUserId: string | null;

  @Index({ unique: true })
  @Column({ type: 'text' })
  endpoint: string;

  @Exclude()
  @Column({ type: 'text' })
  p256dh: string;

  @Exclude()
  @Column({ type: 'text' })
  auth: string;

  /** Coarse only, for the device-pass + debugging: 'ios-pwa' | 'android' | 'desktop' | 'other'. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  deviceHint: string | null;

  @Column({ type: 'int', default: 0 })
  failureCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastSuccessAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
