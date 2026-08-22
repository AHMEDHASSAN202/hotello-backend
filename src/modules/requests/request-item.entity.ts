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
import { RequestCategory } from './request-category.entity';
import { RequestOptionType, TranslationMap } from './requests.constants';

/**
 * Epic 15 — a request catalog item.
 *
 * `hotelId IS NULL`  → platform item: translations complete (7 languages) and
 *                      read-only for hotels (15.1 AC2); seed upserts by
 *                      (categoryId, key).
 * `hotelId` set      → custom hotel item (15.1 AC4): ar+en required, other
 *                      languages optional with en fallback at guest read time.
 *
 * Per-hotel enable/order/SLA overrides live in hotel_request_item_settings —
 * this row never mutates per hotel. Items are never hard-deleted (requests
 * snapshot names, but the FK stays valid for category filtering).
 */
@Entity('request_items')
@Index('UQ_request_items_platform_key', ['categoryId', 'key'], {
  unique: true,
  where: `"hotelId" IS NULL`,
})
@Index('IDX_request_items_category', ['categoryId'])
@Index('IDX_request_items_hotel', ['hotelId'])
export class RequestItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  categoryId: string;

  @ManyToOne(() => RequestCategory)
  @JoinColumn({ name: 'categoryId' })
  category: RequestCategory;

  /** NULL = platform item; set = the owning hotel's custom item. */
  @Column({ type: 'uuid', nullable: true })
  hotelId: string | null;

  @ManyToOne(() => Hotel, { nullable: true })
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel | null;

  /** Seed key for platform items (e.g. 'extra_towels'); NULL for custom. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  key: string | null;

  @Column({ type: 'jsonb' })
  names: TranslationMap;

  @Column({ type: 'jsonb', nullable: true })
  descriptions: TranslationMap | null;

  @Column({ length: 40 })
  icon: string;

  /** 15.1 AC3 — at most one simple option. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  optionType: RequestOptionType | null;

  @Column({ type: 'int', nullable: true })
  optionMin: number | null;

  @Column({ type: 'int', nullable: true })
  optionMax: number | null;

  /** Default SLA target in minutes; hotels override via settings. */
  @Column({ type: 'int' })
  defaultSlaMinutes: number;

  @Column({ type: 'int' })
  sortOrder: number;

  /** Soft-delete flag for custom items (no hard deletes — repo law). */
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
