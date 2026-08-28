import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { RoomType } from './room-type.entity';
import {
  CleaningType,
  HousekeepingStatus,
} from '../housekeeping/housekeeping.constants';

/**
 * `active`/`out_of_service` count toward the plan's `maxRooms` limit and the
 * hotel's derived `roomsCount` (global constraint: countable = active +
 * out_of_service). `inactive` is the no-hard-delete replacement for removal —
 * it never counts and is excluded from guest-facing surfaces.
 */
export type RoomStatus = 'active' | 'out_of_service' | 'inactive';

export const COUNTABLE_ROOM_STATUSES: RoomStatus[] = [
  'active',
  'out_of_service',
];

/**
 * A tenant-scoped room (Epic 11, Story 11.1). Room numbers are always text
 * (leading zeros and letters survive, e.g. "007", "101A") — normalized
 * `trim().toUpperCase()` before save/compare, unique per hotel.
 */
@Entity('rooms')
@Unique('UQ_rooms_hotel_number', ['hotelId', 'roomNumber'])
@Index('IDX_rooms_hotel_status', ['hotelId', 'status'])
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  /** Normalized: trim().toUpperCase(). Always text — "007" and "101A" are valid. */
  @Column({ length: 20 })
  roomNumber: string;

  @Column({ type: 'int', nullable: true })
  floor: number | null;

  @Column('uuid')
  roomTypeId: string;

  @ManyToOne(() => RoomType)
  @JoinColumn({ name: 'roomTypeId' })
  roomType: RoomType;

  @Column({ default: 'active' })
  status: RoomStatus;

  /**
   * Cleanliness axis (Epic 20, 20.1 AC1) — independent from `status`.
   * Current-state-only; history lives in audit. All mutations go through
   * `housekeeping-transitions.ts`.
   */
  @Column({ length: 16, default: 'clean' })
  housekeepingStatus: HousekeepingStatus;

  /** Why the room needs cleaning (20.1 AC2); parked but kept under DND. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  cleaningType: CleaningType | null;

  /**
   * Stay that switched DND on (20.4) — plain uuid on purpose (no FK): stays
   * are permanent records and the board never joins through this.
   */
  @Column({ type: 'uuid', nullable: true })
  dndSetByStayId: string | null;

  /** Current attendant (20.3 AC1); cleared on complete, kept on interrupt. */
  @Column({ type: 'uuid', nullable: true })
  housekeepingAssignedToId: string | null;

  /** Room memory (20.3 AC3) — timestamptz, safe with Date params. */
  @Column({ type: 'timestamptz', nullable: true })
  lastCleanedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  lastCleanedById: string | null;

  /**
   * Hotel-local date the daily job last processed this room — the per-room
   * per-day idempotency key (20.1 AC4 / note 4): stops double daily flags and
   * stops re-clearing a DND the guest re-enabled after today's tick.
   */
  @Column({ type: 'date', nullable: true })
  lastDailyFlaggedOn: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
