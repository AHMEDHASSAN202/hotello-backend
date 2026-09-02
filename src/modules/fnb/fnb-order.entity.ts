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
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { GuestLanguage } from '../tenant-stays/stays.constants';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  FnbCancelReason,
  FnbDestinationType,
  FnbOrderStatus,
  FnbPaymentMethod,
} from './fnb.constants';

/**
 * Epic 16 — a guest F&B order. Permanent record; everything the guest was
 * shown is SNAPSHOT at submission (16.5 AC4 / 16.2 AC6): room, guest, stay
 * type, destination names, currency, totals — menu/location edits never
 * rewrite history. `updatedAt` doubles as the delta cursor (Epic 15 pattern);
 * `dueAt = createdAt + max(prep SLA of involved menus)` is stored so overdue
 * is a plain comparison.
 */
@Entity('fnb_orders')
@Index('IDX_fnb_orders_hotel_status', ['hotelId', 'status'])
@Index('IDX_fnb_orders_hotel_updated', ['hotelId', 'updatedAt'])
@Index('IDX_fnb_orders_stay', ['stayId'])
@Index('IDX_fnb_orders_hotel_created', ['hotelId', 'createdAt'])
@Index('IDX_fnb_orders_hotel_delivered', ['hotelId', 'deliveredAt'])
export class FnbOrder {
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

  /** Snapshots — the stay's room can move after ordering. */
  @Column('uuid')
  roomId: string;

  @Column({ length: 20 })
  roomNumber: string;

  @Column({ length: 120 })
  guestName: string;

  @Column({ length: 5 })
  guestLanguage: GuestLanguage;

  /** Stay type at order time — explains included flags forever. */
  @Column({ length: 20 })
  stayType: string;

  /** Menus involved (distinct) — the board's menu filter reads this. */
  @Column({ type: 'jsonb' })
  menuIds: string[];

  @Column({ length: 10 })
  destinationType: FnbDestinationType;

  @Column({ type: 'uuid', nullable: true })
  locationId: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  locationKey: string | null;

  /** Location display names at order time (16.5 AC4). */
  @Column({ type: 'jsonb', nullable: true })
  locationNames: TranslationMap | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  spot: string | null;

  /** Null = fully-included order, no payment step (16.4 AC3). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  paymentMethod: FnbPaymentMethod | null;

  /** Paid total only — included lines contribute 0. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  totalAmount: number;

  @Column({ length: 3 })
  currency: string;

  @Column({ default: 'new' })
  status: FnbOrderStatus;

  @Column({ type: 'int' })
  slaTargetMinutes: number;

  @Column({ type: 'timestamptz' })
  dueAt: Date;

  @Column({ type: 'uuid', nullable: true })
  assignedToId: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'assignedToId' })
  assignedTo: TenantUser | null;

  @Column({ type: 'uuid', nullable: true })
  startedById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'startedById' })
  startedBy: TenantUser | null;

  @Column({ type: 'uuid', nullable: true })
  deliveredById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'deliveredById' })
  deliveredBy: TenantUser | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'cancelledById' })
  cancelledBy: TenantUser | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  outForDeliveryAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cancelledReason: FnbCancelReason | null;

  @Column({ type: 'text', nullable: true })
  cancelNote: string | null;

  /** 16.8 — room-charge settlement at checkout; null = not settled. */
  @Column({ type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  settledById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'settledById' })
  settledBy: TenantUser | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
