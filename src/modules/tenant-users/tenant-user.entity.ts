import { Exclude } from 'class-transformer';
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

/**
 * Stub for Epic 05 (Story 5.6): only the Hotel Owner exists here — the
 * tenant-scoped super admin holding the tenant wildcard ['*']. Staff/roles
 * management belongs to the Tenant Dashboard epics.
 */
@Entity('tenant_users')
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

  @Column({ unique: true })
  email: string;

  @Column({ default: 'owner' })
  role: string;

  /** Tenant-scoped permissions — mirrors the platform catalog pattern. */
  @Column({ type: 'jsonb', default: () => `'["*"]'` })
  permissions: string[];

  /** `pending` until the owner sets a password via the setup link. */
  @Column({ default: 'pending' })
  status: 'pending' | 'active';

  @Exclude()
  @Column({ type: 'text', nullable: true })
  passwordHash: string | null;

  /** sha256 of the raw setup token — the raw value is never stored. */
  @Exclude()
  @Column({ type: 'text', nullable: true })
  setupTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  setupTokenExpiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
