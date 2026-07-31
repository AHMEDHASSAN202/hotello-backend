import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(entry: AuditEntry): Promise<AuditLog> {
    return this.auditRepo.save(
      this.auditRepo.create({
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorId: entry.actorId ?? null,
        metadata: entry.metadata ?? null,
      }),
    );
  }

  /**
   * Count audit rows for one action against one entity since a timestamp —
   * used as a per-target rate-limit ledger (e.g. manager password resets,
   * Story 9.8 AC4) without adding bespoke counter columns.
   */
  async countSince(
    action: string,
    entityId: string,
    since: Date,
  ): Promise<number> {
    return this.auditRepo.count({
      where: { action, entityId, createdAt: MoreThanOrEqual(since) },
    });
  }
}
