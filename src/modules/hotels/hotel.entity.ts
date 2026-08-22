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

  // Hotel-local checkout hour 'HH:MM' (Epic 13, Story 13.4 AC2) — the daily
  // auto-checkout job compares it against hotel-local time via `timezone`.
  @Column({ length: 5, default: '12:00' })
  checkoutTime: string;

  // Pre-selected board basis at check-in (Epic 16, Story 16.1 AC2) —
  // resorts set all_inclusive, city hotels keep room_only.
  @Column({ length: 20, default: 'room_only' })
  defaultStayType: string;

  // F&B payment methods (16.4 AC1): cash is always on; room charge is the
  // only opt-in. A methods table appears only when online payment does.
  @Column({ default: false })
  fnbRoomChargeEnabled: boolean;

  /**
   * Guest App accent color '#RRGGBB' (Epic 14, Story 14.4 AC5). Applied only
   * when the plan includes `guest_app_branding`; null = GXP default. Set by a
   * future branding UI — this epic ships the column and the rendering path.
   */
  @Column({ type: 'varchar', length: 7, nullable: true })
  brandAccentColor: string | null;

  // Sales-declared count from onboarding — reference only, no guard reads it (11.6 AC2).
  @Column({ type: 'int', default: 0 })
  declaredRoomsCount: number;

  // Derived: countable rooms (active + out_of_service), synced by TenantRoomsService (11.6 AC1).
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

  // Set on first QR PDF generation — drives the tenant setup checklist.
  @Column({ type: 'timestamptz', nullable: true })
  qrGeneratedAt: Date | null;

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
