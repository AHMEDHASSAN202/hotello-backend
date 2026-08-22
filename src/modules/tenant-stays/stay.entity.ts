import { Exclude } from 'class-transformer';
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
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { Room } from '../tenant-rooms/room.entity';
import {
  CheckoutType,
  GuestLanguage,
  StayStatus,
  StayType,
} from './stays.constants';

/**
 * A guest stay (Epic 13) — the bridge between a room and a guest session.
 * Stays are permanent records: no delete anywhere (13.2 AC2), `checked_out`
 * is final (13.4 AC4 — a returning guest gets a new stay + new code).
 *
 * The stay code exists only as `codeHash` — HMAC-SHA256 with a server secret
 * (13.1 AC3 chose hash-only storage; forgetting the code = regenerate).
 * Deterministic HMAC (not bcrypt) so uniqueness among a hotel's active stays
 * is DB-enforceable and login lookup is a single indexed hit.
 *
 * `UQ_stays_room_active` is the race-safe one-active-stay-per-room rule
 * (13.1 AC2): two simultaneous check-ins → one insert wins, the loser maps
 * the 23505 to 409 ROOM_OCCUPIED.
 */
@Entity('stays')
@Index('IDX_stays_hotel_status', ['hotelId', 'status'])
@Index('UQ_stays_room_active', ['roomId'], {
  unique: true,
  where: `"status" = 'active'`,
})
@Index('UQ_stays_hotel_code_active', ['hotelId', 'codeHash'], {
  unique: true,
  where: `"status" = 'active'`,
})
export class Stay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column('uuid')
  roomId: string;

  @ManyToOne(() => Room)
  @JoinColumn({ name: 'roomId' })
  room: Room;

  @Column({ length: 120 })
  guestName: string;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  /** One of GUEST_LANGUAGES — drives notifications and the Guest App locale. */
  @Column({ length: 5 })
  language: GuestLanguage;

  @Column({ type: 'int', nullable: true })
  guestsCount: number | null;

  /** Board basis (16.1 AC1) — the F&B pricing input; editable via stay edit. */
  @Column({ length: 20, default: 'room_only' })
  stayType: StayType;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** HMAC-SHA256(code, STAY_CODE_HMAC_SECRET) hex — never the plaintext. */
  @Exclude()
  @Column({ length: 64 })
  codeHash: string;

  /** Calendar dates in the hotel's timezone — no time component. */
  @Column({ type: 'date' })
  checkInDate: string;

  @Column({ type: 'date' })
  checkOutDate: string;

  @Column({ default: 'active' })
  status: StayStatus;

  @Column({ type: 'varchar', nullable: true })
  checkoutType: CheckoutType | null;

  @Column({ type: 'timestamptz', nullable: true })
  checkedOutAt: Date | null;

  /** Null when the auto-checkout job (system actor) closed the stay. */
  @Column({ type: 'uuid', nullable: true })
  checkedOutById: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'checkedOutById' })
  checkedOutBy: TenantUser | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
