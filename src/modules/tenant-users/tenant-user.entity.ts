import { Exclude } from 'class-transformer';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TenantRole } from '../tenant-roles/tenant-role.entity';

/**
 * A user of the Tenant (Hotel) Dashboard. Seeded as the Hotel Owner in Epic 05
 * (holding the seeded Owner role with the tenant wildcard ['*']); staff
 * accounts arrive in Epic 09.
 *
 * Both `email` and `username` are unique **per hotel**, not globally (Epic 08,
 * Story 8.3 AC1): the same person can own/work at more than one hotel, and
 * credentials never cross tenants. A user signs in with whichever they have —
 * owners always have an email; username-only staff accounts (Epic 09) have no
 * email and therefore cannot self-reset (Story 8.4 AC5).
 *
 * Permissions resolve through the assigned role (Epic 09, spec note #1) — the
 * single source of truth, reloaded per request by the tenant-jwt strategy so
 * role edits take effect immediately.
 */
@Entity('tenant_users')
@Unique('UQ_tenant_users_hotel_email', ['hotelId', 'email'])
@Unique('UQ_tenant_users_hotel_username', ['hotelId', 'username'])
// Story 9.7 AC3 — every account carries at least one login identifier.
@Check('CHK_tenant_users_identifier', `"email" IS NOT NULL OR "username" IS NOT NULL`)
export class TenantUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column()
  name: string;

  /**
   * Null for username-only accounts (Epic 09). Owners always have one.
   * `varchar` (not text) to match the baseline column — the username migration
   * only dropped NOT NULL; keep the entity in sync or migration:check drifts.
   */
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  /** Set for staff accounts created without an email (Epic 09, Story 9.7). */
  @Column({ type: 'text', nullable: true })
  username: string | null;

  @Column('uuid')
  roleId: string;

  @ManyToOne(() => TenantRole)
  @JoinColumn({ name: 'roleId' })
  role: TenantRole;

  /**
   * `pending` until the owner sets a password via the setup link; `active`
   * once activated; `disabled` when a staff account is switched off (Epic 09).
   * A non-`active` user can never authenticate (Story 8.3 AC2).
   */
  @Column({ default: 'pending' })
  status: 'pending' | 'active' | 'disabled';

  /**
   * `ar` | `en` — the user's own preference (Story 8.7). Null follows the
   * hotel's `defaultLanguage`; drives reset-email language (Story 8.4 AC1).
   */
  @Column({ type: 'text', nullable: true })
  preferredLanguage: 'ar' | 'en' | null;

  @Exclude()
  @Column({ type: 'text', nullable: true })
  passwordHash: string | null;

  /** sha256 of the raw setup token — the raw value is never stored. */
  @Exclude()
  @Column({ type: 'text', nullable: true })
  setupTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  setupTokenExpiresAt: Date | null;

  /** bcrypt hash of the current refresh token — rotated on every use, cleared on logout / password change (Story 8.5). */
  @Exclude()
  @Column({ type: 'text', nullable: true })
  refreshTokenHash: string | null;

  /** sha256 of the raw password-reset token — single-use, short-lived (Story 8.4 AC2). */
  @Exclude()
  @Column({ type: 'text', nullable: true })
  resetTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resetTokenExpiresAt: Date | null;

  /**
   * Story 9.7 AC4 / 9.8 AC1 — set when an account is created directly or reset
   * by a manager with a temporary password. Until the user changes it, a guard
   * blocks every tenant route except the change-password flow itself.
   */
  @Column({ default: false })
  mustChangePassword: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  /**
   * Epic 12, Story 12.4 AC2 — first-run hint keys this user dismissed,
   * persisted server-side so dismissal survives devices/browsers. Values are
   * validated against TENANT_HINT_KEYS (code is the source of truth).
   */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  dismissedHints: string[];

  /**
   * When the current setup invite was (re)sent — Epic 09, Story 9.6 AC2. Backs
   * the per-user 10-minute resend cooldown; stamped on invite and each resend.
   */
  @Column({ type: 'timestamptz', nullable: true })
  inviteSentAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
