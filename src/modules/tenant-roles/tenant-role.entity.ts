import {
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

/**
 * A tenant-scoped role (Epic 09, Story 9.1). Every hotel is seeded with a set
 * of default roles (Owner/Manager/Front Desk/Housekeeping); staff are assigned
 * one at invite time. Permissions resolve **through the role** — the single
 * source of truth (mirrors the platform Admin → Role model). The full role
 * management UI/API arrives in Epic 10.
 *
 * Names are unique per hotel per language so the invite/edit dropdowns never
 * show two "Manager" roles. The Owner role carries the wildcard ['*'] and is
 * flagged `isSystem` — it cannot be edited, deleted or assigned to staff.
 */
@Entity('tenant_roles')
@Unique('UQ_tenant_roles_hotel_name_en', ['hotelId', 'nameEn'])
@Unique('UQ_tenant_roles_hotel_name_ar', ['hotelId', 'nameAr'])
export class TenantRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column()
  nameEn: string;

  @Column()
  nameAr: string;

  @Column({ type: 'text', nullable: true })
  descriptionEn: string | null;

  @Column({ type: 'text', nullable: true })
  descriptionAr: string | null;

  /** Tenant-scoped permission keys (tenant-permissions.constants) or ['*']. */
  @Column('text', { array: true, default: '{}' })
  permissions: string[];

  /** The Owner role — protected from edit/delete/assign (Story 9.1 AC3). */
  @Column({ default: false })
  isSystem: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
