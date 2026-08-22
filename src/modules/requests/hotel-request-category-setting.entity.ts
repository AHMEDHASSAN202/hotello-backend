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
import { RequestCategory } from './request-category.entity';

/**
 * Epic 15 — per-hotel category curation (15.1 AC2). Row absence means the
 * category is enabled (lazy defaults: a brand-new hotel sees the full
 * catalog with zero settings rows).
 */
@Entity('hotel_request_category_settings')
@Unique('UQ_hotel_request_category', ['hotelId', 'categoryId'])
export class HotelRequestCategorySetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column('uuid')
  categoryId: string;

  @ManyToOne(() => RequestCategory)
  @JoinColumn({ name: 'categoryId' })
  category: RequestCategory;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
