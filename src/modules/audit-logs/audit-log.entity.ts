import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** e.g. 'plan.created', 'subscription.changed' */
  @Column()
  action: string;

  @Column()
  entityType: string;

  @Column('uuid')
  entityId: string;

  /** Null when the actor is the system (e.g. the trial-expiry cron). */
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
