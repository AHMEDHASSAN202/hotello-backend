import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let auditRepo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    auditRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (entry) => ({ id: 'log-1', ...entry })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
      ],
    }).compile();

    service = moduleRef.get(AuditLogsService);
  });

  it('persists action, entity, actor and metadata', async () => {
    await service.log({
      action: 'plan.created',
      entityType: 'plan',
      entityId: 'plan-1',
      actorId: 'admin-1',
      metadata: { nameEn: 'Standard' },
    });

    expect(auditRepo.save).toHaveBeenCalledWith({
      action: 'plan.created',
      entityType: 'plan',
      entityId: 'plan-1',
      actorId: 'admin-1',
      metadata: { nameEn: 'Standard' },
    });
  });

  it('defaults actorId and metadata to null for system actions', async () => {
    await service.log({
      action: 'subscription.expired',
      entityType: 'subscription',
      entityId: 'sub-1',
    });

    expect(auditRepo.save).toHaveBeenCalledWith({
      action: 'subscription.expired',
      entityType: 'subscription',
      entityId: 'sub-1',
      actorId: null,
      metadata: null,
    });
  });
});
