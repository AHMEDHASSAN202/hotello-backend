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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
