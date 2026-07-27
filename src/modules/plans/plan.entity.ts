import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../common/transformers/decimal.transformer';
import { Admin } from '../admins/admin.entity';

export type PlanStatus = 'active' | 'archived';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  nameEn: string;

  @Column()
  nameAr: string;

  @Column({ type: 'text', nullable: true })
  descriptionEn: string | null;

  @Column({ type: 'text', nullable: true })
  descriptionAr: string | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  monthlyPrice: number;

  /** Null = yearly billing unavailable for this plan. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: new ColumnNumericTransformer(),
  })
  yearlyPrice: number | null;

  @Column({ default: 'EGP' })
  currency: string;

  /** Null limits = unlimited. */
  @Column({ type: 'int', nullable: true })
  maxRooms: number | null;

  @Column({ type: 'int', nullable: true })
  maxStaffUsers: number | null;

  @Column({ type: 'int', nullable: true })
  maxGuestRequestsPerMonth: number | null;

  @Column('text', { array: true, default: '{}' })
  enabledModules: string[];

  @Column({ default: 'active' })
  status: PlanStatus;

  @Column({ default: false })
  isTrial: boolean;

  @Column({ type: 'int', nullable: true })
  trialDurationDays: number | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => Admin, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: Admin | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
