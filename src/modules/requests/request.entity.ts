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
import { Hotel } from '../hotels/hotel.entity';
import { Room } from '../tenant-rooms/room.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';
import {
  RequestCancelReason,
  RequestOptionType,
  RequestStatus,
} from './requests.constants';
import { GuestLanguage } from '../tenant-stays/stays.constants';

/**
 * Epic 15 — a guest request. Permanent record (no deletes): item names, icon,
 * SLA target, room id + number are SNAPSHOTS taken at submission (15.1 AC5 /
 * spec note 6) — catalog edits, stay room moves and room renumbering never
 * rewrite history. `dueAt = createdAt + slaTargetMinutes` is stored so
 * overdue queries are a plain comparison; amber/red chip states are computed
 * client-side so they flip live between polls (recorded decision).
 *
 * `updatedAt` doubles as the delta-polling cursor (spec note 4): any
 * transition bumps it, so `updatedSince` returns exactly the changed rows.
 */
@Entity('requests')
@Index('IDX_requests_hotel_status', ['hotelId', 'status'])
@Index('IDX_requests_hotel_updated', ['hotelId', 'updatedAt'])
@Index('IDX_requests_stay', ['stayId'])
@Index('IDX_requests_hotel_created', ['hotelId', 'createdAt'])
export class GuestRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column('uuid')
  stayId: string;

  @ManyToOne(() => Stay)
  @JoinColumn({ name: 'stayId' })
  stay: Stay;

  /** Snapshot of the stay's room at submission (stay.roomId is mutable). */
  @Column('uuid')
  roomId: string;

  @ManyToOne(() => Room)
  @JoinColumn({ name: 'roomId' })
  room: Room;

  @Column({ length: 20 })
  roomNumber: string;

  @Column('uuid')
  itemId: string;

  @ManyToOne(() => RequestItem)
  @JoinColumn({ name: 'itemId' })
  item: RequestItem;

  /** Denormalized from the item at submission — drives the board's category filter. */
  @Column('uuid')
  categoryId: string;

  @ManyToOne(() => RequestCategory)
  @JoinColumn({ name: 'categoryId' })
  category: RequestCategory;

  /** Full translation map snapshot — guest sees their language, staff ar/en. */
  @Column({ type: 'jsonb' })
  itemNames: Record<string, string>;

  @Column({ length: 40 })
  itemIcon: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  optionType: RequestOptionType | null;

  /** Quantity as decimal string ('2') or time as 'HH:MM'. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  optionValue: string | null;

  /** Free text in the guest's language — shown as-is with a language tag (MVP). */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  noteLanguage: GuestLanguage | null;

  @Column({ default: 'new' })
  status: RequestStatus;

  @Column({ type: 'int' })
  slaTargetMinutes: number;

  @Column({ type: 'timestamptz' })
  dueAt: Date;

  @Column({ type: 'uuid', nullable: true })
  assignedToId: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'assignedToId' })
  assignedTo: TenantUser | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  startedById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'startedById' })
  startedBy: TenantUser | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  completedById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'completedById' })
  completedBy: TenantUser | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  /** NULL actor = the guest cancelled (reason 'guest'). */
  @Column({ type: 'uuid', nullable: true })
  cancelledById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'cancelledById' })
  cancelledBy: TenantUser | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cancelledReason: RequestCancelReason | null;

  @Column({ type: 'text', nullable: true })
  cancelNote: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
