import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { MAIL_DRIVER } from '../mail/mail.interface';
import { Role } from '../roles/role.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { NotificationOutbox } from './notification.entity';
import { EnqueueInput, NotificationsService } from './notifications.service';

const BASE_MS = 60_000;

describe('NotificationsService', () => {
  let service: NotificationsService;
  let outboxRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let hotelsRepo: { findOne: jest.Mock };
  let tenantUsersRepo: { findOne: jest.Mock };
  let mailDriver: { send: jest.Mock };
  let tenantUsersService: {
    regenerateSetupLink: jest.Mock;
    issueSetupToken: jest.Mock;
    buildSetupLink: jest.Mock;
  };
  let auditLogs: { log: jest.Mock };

  const actor = {
    id: 'admin-1',
    role: { permissions: ['*'] } as Role,
  } as Admin;

  const enqueueInput = (
    overrides: Partial<EnqueueInput> = {},
  ): EnqueueInput => ({
    type: 'trial_countdown',
    recipientName: 'Owner One',
    recipientEmail: 'owner@nilegrand.example',
    hotelId: 'hotel-1',
    tenantUserId: 'owner-1',
    language: 'en',
    variables: {
      hotelName: 'Nile Grand',
      ownerName: 'Owner One',
      daysRemaining: 7,
      trialEndsAt: '15 Aug 2026',
    },
    dedupeKey: 'trial_countdown:sub-1:7:2026-08-15',
    ...overrides,
  });

  const makeRow = (
    overrides: Partial<NotificationOutbox> = {},
  ): NotificationOutbox =>
    ({
      id: 'notif-1',
      type: 'trial_countdown',
      channel: 'email',
      recipientName: 'Owner One',
      recipientEmail: 'owner@nilegrand.example',
      hotelId: 'hotel-1',
      tenantUserId: 'owner-1',
      language: 'en',
      subject: 'Reminder',
      bodyHtml: '<html>body</html>',
      variables: {
        hotelName: 'Nile Grand',
        ownerName: 'Owner One',
        daysRemaining: 7,
        trialEndsAt: '15 Aug 2026',
      },
      dedupeKey: 'trial_countdown:sub-1:7:2026-08-15',
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      attempts: [],
      sentAt: null,
      resendOfId: null,
      ...overrides,
    }) as NotificationOutbox;

  beforeEach(async () => {
    outboxRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => ({ id: row.id ?? 'notif-new', ...row })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(null) };
    tenantUsersRepo = { findOne: jest.fn().mockResolvedValue(null) };
    mailDriver = { send: jest.fn().mockResolvedValue(undefined) };
    tenantUsersService = {
      regenerateSetupLink: jest.fn(),
      issueSetupToken: jest.fn(),
      buildSetupLink: jest.fn(
        (slug: string, raw: string) =>
          `https://${slug}.gxp.example/setup?token=${raw}`,
      ),
    };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(NotificationOutbox), useValue: outboxRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(TenantUser), useValue: tenantUsersRepo },
        { provide: MAIL_DRIVER, useValue: mailDriver },
        { provide: TenantUsersService, useValue: tenantUsersService },
        { provide: AuditLogsService, useValue: auditLogs },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => fallback),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  describe('outbox lifecycle (6.1)', () => {
    it('persists a pending record with rendered content before any send (AC1)', async () => {
      const row = await service.enqueue(enqueueInput());

      expect(outboxRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trial_countdown',
          channel: 'email',
          recipientEmail: 'owner@nilegrand.example',
          language: 'en',
          status: 'pending',
          attemptCount: 0,
        }),
      );
      expect(row!.subject).toContain('7 days');
      expect(row!.bodyHtml).toContain('Nile Grand');
      // Persist-first: enqueue never touches the driver.
      expect(mailDriver.send).not.toHaveBeenCalled();
    });

    it('marks the record sent with a timeline entry on success (AC2)', async () => {
      const row = makeRow();
      await service.attemptSend(row);

      expect(mailDriver.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'owner@nilegrand.example',
          subject: 'Reminder',
          html: '<html>body</html>',
        }),
      );
      expect(row.status).toBe('sent');
      expect(row.sentAt).toBeInstanceOf(Date);
      expect(row.attempts).toEqual([
        expect.objectContaining({ ok: true, error: null }),
      ]);
      expect(outboxRepo.save).toHaveBeenCalledWith(row);
    });

    it('captures a provider failure without throwing and schedules a retry (AC2, 6.2 AC3)', async () => {
      mailDriver.send.mockRejectedValue(new Error('SMTP connection refused'));
      const row = makeRow();
      const before = Date.now();

      await expect(service.attemptSend(row)).resolves.toBeUndefined();

      expect(row.status).toBe('pending');
      expect(row.attemptCount).toBe(1);
      expect(row.lastError).toBe('SMTP connection refused');
      expect(row.attempts).toEqual([
        expect.objectContaining({ ok: false, error: 'SMTP connection refused' }),
      ]);
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
        before + BASE_MS,
      );
      expect(row.nextAttemptAt!.getTime()).toBeLessThan(before + BASE_MS + 5000);
    });

    it('doubles the backoff on each subsequent failure (AC2)', async () => {
      mailDriver.send.mockRejectedValue(new Error('still down'));
      const row = makeRow({ attemptCount: 1 });
      const before = Date.now();

      await service.attemptSend(row);

      // Second failure → delay = base × 2^(2-1) = 2 × base.
      expect(row.attemptCount).toBe(2);
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
        before + 2 * BASE_MS,
      );
    });

    it('lands on failed after the third attempt (default max, AC2)', async () => {
      mailDriver.send.mockRejectedValue(new Error('still down'));
      const row = makeRow({ attemptCount: 2 });

      await service.attemptSend(row);

      expect(row.attemptCount).toBe(3);
      expect(row.status).toBe('failed');
      expect(row.nextAttemptAt).toBeNull();
    });

    it('does not send records that are not pending', async () => {
      await service.attemptSend(makeRow({ status: 'sent' }));
      await service.attemptSend(makeRow({ status: 'failed' }));
      expect(mailDriver.send).not.toHaveBeenCalled();
    });

    it('processDue picks only due pending records, oldest first', async () => {
      const due = makeRow();
      outboxRepo.find.mockResolvedValue([due]);

      const count = await service.processDue();

      expect(count).toBe(1);
      expect(outboxRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
          order: { nextAttemptAt: 'ASC' },
          take: 20,
        }),
      );
      expect(mailDriver.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotency (6.1 AC4)', () => {
    it('treats a unique violation on the dedupe key as "already queued" and skips', async () => {
      const uniqueError = new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      outboxRepo.save.mockRejectedValue(uniqueError);

      await expect(service.enqueue(enqueueInput())).resolves.toBeNull();
      expect(mailDriver.send).not.toHaveBeenCalled();
    });

    it('rethrows non-unique database errors', async () => {
      outboxRepo.save.mockRejectedValue(new Error('connection lost'));
      await expect(service.enqueue(enqueueInput())).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('render failure (6.3 AC5)', () => {
    it('records a missing variable as an immediately-failed outbox row; the driver is never called', async () => {
      const row = await service.enqueue(
        enqueueInput({ variables: { hotelName: 'Nile Grand' } }),
      );

      expect(row!.status).toBe('failed');
      expect(row!.lastError).toContain('trial_countdown');
      expect(row!.lastError).toContain('ownerName');
      expect(row!.attempts).toEqual([
        expect.objectContaining({ ok: false }),
      ]);
      expect(mailDriver.send).not.toHaveBeenCalled();
    });
  });

  describe('language resolution (6.3 AC1 / 8.4 AC1)', () => {
    it("follows the hotel's default language, falling back to ar", () => {
      expect(service.resolveLanguage({ defaultLanguage: 'en' })).toBe('en');
      expect(service.resolveLanguage({ defaultLanguage: 'ar' })).toBe('ar');
      expect(service.resolveLanguage({ defaultLanguage: 'fr' })).toBe('ar');
    });

    it("prefers the tenant user's preferredLanguage when set (note 6)", () => {
      expect(
        service.resolveLanguage(
          { defaultLanguage: 'ar' },
          { preferredLanguage: 'en' },
        ),
      ).toBe('en');
      expect(
        service.resolveLanguage(
          { defaultLanguage: 'en' },
          { preferredLanguage: 'ar' },
        ),
      ).toBe('ar');
    });

    it("falls back to the hotel default when the user has no preference", () => {
      expect(
        service.resolveLanguage(
          { defaultLanguage: 'en' },
          { preferredLanguage: null },
        ),
      ).toBe('en');
    });
  });

  describe('setup-link retry regenerates the token (6.4 AC2)', () => {
    const setupRow = () =>
      makeRow({
        type: 'owner_setup_link',
        variables: {
          hotelName: 'Nile Grand',
          ownerName: 'Owner One',
          expiresAt: '1 Aug 2026',
        },
        dedupeKey: 'owner_setup_link:owner-1:abc123',
      });

    beforeEach(() => {
      tenantUsersRepo.findOne.mockResolvedValue({
        id: 'owner-1',
        status: 'pending',
        name: 'Owner One',
      });
      hotelsRepo.findOne.mockResolvedValue({
        id: 'hotel-1',
        slug: 'nile-grand',
      });
      tenantUsersService.issueSetupToken.mockResolvedValue({
        raw: 'fresh-raw-token',
        expiresAt: new Date('2026-08-01T00:00:00Z'),
      });
    });

    it('mints a fresh token, sends the real URL, and persists only the masked body', async () => {
      const row = setupRow();
      await service.attemptSend(row);

      expect(tenantUsersService.issueSetupToken).toHaveBeenCalled();
      const sent = mailDriver.send.mock.calls[0][0];
      expect(sent.html).toContain('fresh-raw-token');
      expect(sent.redact).toEqual(['fresh-raw-token']);
      // The row keeps the masked render only.
      expect(row.bodyHtml).toContain('********');
      expect(row.bodyHtml).not.toContain('fresh-raw-token');
      expect(row.subject).not.toContain('fresh-raw-token');
      expect(JSON.stringify(row.variables)).not.toContain('fresh-raw-token');
      expect(row.status).toBe('sent');
    });

    it('fails terminally when the owner already activated their account', async () => {
      tenantUsersRepo.findOne.mockResolvedValue({
        id: 'owner-1',
        status: 'active',
      });
      const row = setupRow();

      await service.attemptSend(row);

      expect(row.status).toBe('failed');
      expect(row.lastError).toContain('already active');
      expect(tenantUsersService.issueSetupToken).not.toHaveBeenCalled();
      expect(mailDriver.send).not.toHaveBeenCalled();
    });

    it('uses the in-memory real body on the first attempt without regenerating', async () => {
      const row = setupRow();
      await service.attemptSend(row, {
        html: '<html>real with original-token</html>',
        redact: ['original-token'],
      });

      expect(tenantUsersService.issueSetupToken).not.toHaveBeenCalled();
      expect(mailDriver.send).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<html>real with original-token</html>',
          redact: ['original-token'],
        }),
      );
    });
  });

  describe('detail response shaping (6.7 AC3)', () => {
    it('returns the rendered body + timeline but never internal fields or the raw hotel entity', async () => {
      outboxRepo.findOne.mockResolvedValue(
        makeRow({
          attempts: [{ at: '2026-07-28T10:00:00Z', ok: false, error: 'boom' }],
          lastError: 'boom',
          hotel: {
            id: 'hotel-1',
            nameEn: 'Nile Grand',
            nameAr: 'نايل جراند',
            suspensionNote: 'internal: unpaid invoice #90',
          } as never,
        }),
      );

      const detail = await service.getDetail('notif-1');

      expect(detail.subject).toBe('Reminder');
      expect(detail.bodyHtml).toBe('<html>body</html>');
      expect(detail.attempts).toHaveLength(1);
      // Hotel is a ref, not the entity — internal notes never ride along.
      expect(detail.hotel).toEqual({
        id: 'hotel-1',
        nameEn: 'Nile Grand',
        nameAr: 'نايل جراند',
      });
      expect(JSON.stringify(detail)).not.toContain('unpaid invoice');
      expect(detail).not.toHaveProperty('variables');
      expect(detail).not.toHaveProperty('dedupeKey');
    });
  });

  describe('resend (6.7 AC4)', () => {
    it('re-renders a failed notification from stored variables into a new linked row and audits', async () => {
      const original = makeRow({ status: 'failed', attemptCount: 3 });
      outboxRepo.findOne.mockImplementation(async ({ where }) =>
        where.id === 'notif-1'
          ? original
          : makeRow({ id: where.id, status: 'sent' }),
      );

      await service.resend('notif-1', actor);

      // Fresh row: no dedupe key (resends always go through), lineage kept.
      expect(outboxRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          resendOfId: 'notif-1',
          dedupeKey: null,
          status: 'pending',
        }),
      );
      expect(mailDriver.send).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'notification.resent',
          actorId: 'admin-1',
          metadata: expect.objectContaining({
            originalId: 'notif-1',
            type: 'trial_countdown',
          }),
        }),
      );
    });

    it('routes a failed setup link through the regeneration flow — never the stale body', async () => {
      const original = makeRow({
        id: 'notif-1',
        type: 'owner_setup_link',
        status: 'failed',
      });
      const fresh = makeRow({ id: 'notif-2', resendOfId: 'notif-1' });
      outboxRepo.findOne.mockImplementation(async ({ where }) => {
        if (where.id === 'notif-1') return original;
        if (where.id === 'notif-2') return fresh;
        if (where.resendOfId === 'notif-1') return fresh;
        return null;
      });

      await service.resend('notif-1', actor);

      expect(tenantUsersService.regenerateSetupLink).toHaveBeenCalledWith(
        'hotel-1',
        actor,
        { resendOfId: 'notif-1' },
      );
      // The stale body was not re-sent by this path.
      expect(mailDriver.send).not.toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.resent' }),
      );
    });

    it('rejects resending a non-failed notification with 409', async () => {
      outboxRepo.findOne.mockResolvedValue(makeRow({ status: 'sent' }));
      await expect(service.resend('notif-1', actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('returns 404 for an unknown notification', async () => {
      outboxRepo.findOne.mockResolvedValue(null);
      await expect(service.resend('missing', actor)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
