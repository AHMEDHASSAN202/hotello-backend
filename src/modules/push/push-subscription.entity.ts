import { Exclude } from 'class-transformer';
import {
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
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  /** Bound to the stay at grant time (23.2 AC4); re-binding updates this row. */
  @Column('uuid')
  stayId: string;

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
