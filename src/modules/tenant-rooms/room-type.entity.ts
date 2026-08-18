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
 * A tenant-scoped room type (Epic 11, Story 11.1). Every hotel is seeded with
 * three default types (Standard/Deluxe/Suite) on onboarding; hotels can add
 * more or deactivate ones they don't use. Rooms reference a type — the room
 * management UI groups/filters by it.
 *
 * Names are unique per hotel per language, mirroring `TenantRole`. No hard
 * delete: a type in use by a room is deactivated (`isActive`), never removed.
 */
@Entity('room_types')
@Unique('UQ_room_types_hotel_name_en', ['hotelId', 'nameEn'])
@Unique('UQ_room_types_hotel_name_ar', ['hotelId', 'nameAr'])
export class RoomType {
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

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
