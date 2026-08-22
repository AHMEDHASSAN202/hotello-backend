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
import { RequestItem } from './request-item.entity';

/**
 * Epic 15 — per-hotel item curation (15.1 AC2): enable/disable, reorder
 * within the category, and SLA override. NULL column = "use the item's
 * platform default"; row absence = all defaults. Applies to platform items
 * and the hotel's own custom items alike (one curation path).
 */
@Entity('hotel_request_item_settings')
@Unique('UQ_hotel_request_item', ['hotelId', 'itemId'])
export class HotelRequestItemSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column('uuid')
  itemId: string;

  @ManyToOne(() => RequestItem)
  @JoinColumn({ name: 'itemId' })
  item: RequestItem;

  @Column({ type: 'boolean', nullable: true })
  enabled: boolean | null;

  @Column({ type: 'int', nullable: true })
  sortOrder: number | null;

  @Column({ type: 'int', nullable: true })
  slaMinutes: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
