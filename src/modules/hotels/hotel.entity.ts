import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { HotelStatus, SuspensionReason } from './hotels.constants';

@Entity('hotels')
export class Hotel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  nameEn: string;

  @Column()
  nameAr: string;

  /** Drives the tenant URLs — immutable except by Super Admin (*). */
  @Column({ unique: true })
  slug: string;

  /**
   * `suspended` fully locks the tenant (Story 5.5 AC3) — stricter than trial
   * expiry (read-only). `inactive` is reserved for future offboarding.
   */
  @Column({ default: 'active' })
  status: HotelStatus;

  /** Storage key (never a URL) — resolved via GET /files/{key}. */
  @Column({ type: 'text', nullable: true })
  logoPath: string | null;

  @Column({ type: 'int', nullable: true })
  starRating: number | null;

  @Column()
  contactEmail: string;

  @Column()
  contactPhone: string;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  // Coordinates captured with the address (Google Places selection in the
  // dashboards) — the address text and the pair travel together.
  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column()
  city: string;

  @Column({ default: 'Egypt' })
  country: string;

  @Column({ default: 'Africa/Cairo' })
  timezone: string;

  @Column({ default: 'ar' })
  defaultLanguage: string;

  @Column({ default: 'EGP' })
  currency: string;

  // Usage counters compared against plan limits by the subscription guards.
  @Column({ type: 'int', default: 0 })
  roomsCount: number;

  @Column({ type: 'int', default: 0 })
  staffUsersCount: number;

  @Column({ type: 'int', default: 0 })
  monthlyGuestRequests: number;

  @Column({ type: 'text', nullable: true })
  suspensionReason: SuspensionReason | null;

  @Column({ type: 'text', nullable: true })
  suspensionNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  suspendedById: string | null;

  @ManyToOne(() => Admin, { nullable: true })
  @JoinColumn({ name: 'suspendedById' })
  suspendedBy: Admin | null;

  @Column({ type: 'uuid', nullable: true })
  onboardedById: string | null;

  @ManyToOne(() => Admin, { nullable: true })
  @JoinColumn({ name: 'onboardedById' })
  onboardedBy: Admin | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
