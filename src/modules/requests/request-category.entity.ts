import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TranslationMap } from './requests.constants';

/**
 * Epic 15 — a platform-owned request category (Housekeeping, Maintenance…).
 * Shared rows: every hotel reads the same catalog rows; per-hotel curation
 * lives in hotel_request_category_settings. Platform translation fixes
 * propagate to all hotels automatically (spec note 1 — the recorded choice).
 */
@Entity('request_categories')
export class RequestCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable code key the seed upserts by (e.g. 'housekeeping'). */
  @Column({ length: 40, unique: true })
  key: string;

  /** lucide icon name rendered by both frontends. */
  @Column({ length: 40 })
  icon: string;

  /** All 7 guest languages (spec note 2) — one row, not seven. */
  @Column({ type: 'jsonb' })
  names: TranslationMap;

  @Column({ type: 'int' })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
