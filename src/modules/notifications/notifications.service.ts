import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LessThanOrEqual,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { MAIL_DRIVER, MailDriver } from '../mail/mail.interface';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationOutbox } from './notification.entity';
import {
  NotificationLanguage,
  NotificationType,
} from './notifications.constants';
import {
  formatNotificationDate,
  renderNotification,
  renderSetupLinkEmail,
  renderStaffInviteEmail,
} from './templates/render';

const RETRY_BATCH_SIZE = 20;

export interface EnqueueInput {
  type: NotificationType;
  recipientName: string;
  recipientEmail: string;
  hotelId?: string | null;
  tenantUserId?: string | null;
  language: NotificationLanguage;
  /** Non-secret variables only — persisted to jsonb. */
  variables: Record<string, unknown>;
  dedupeKey?: string | null;
  resendOfId?: string | null;
  /** Pre-rendered content (masked setup links) — skips the standard render. */
  prerendered?: { subject: string; html: string };
}

/** Real body handed through the call stack at emission time — never stored. */
export interface InMemoryBody {
  html: string;
  redact: string[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationOutbox)
    private readonly outboxRepo: Repository<NotificationOutbox>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    @Inject(MAIL_DRIVER) private readonly mailDriver: MailDriver,
    private readonly tenantUsersService: TenantUsersService,
    private readonly auditLogs: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  /** Story 6.3 AC1 / note 8 — the single language-resolution point. */
  /**
   * The single language-resolution point (spec note 8). A tenant user's own
   * `preferredLanguage` wins when set (Story 8.4 AC1 / note 6); otherwise the
   * hotel's `defaultLanguage`. Anything other than `en` resolves to `ar`.
   */
  resolveLanguage(
    hotel: Pick<Hotel, 'defaultLanguage'>,
    user?: Pick<TenantUser, 'preferredLanguage'> | null,
  ): NotificationLanguage {
    const preferred = user?.preferredLanguage ?? hotel.defaultLanguage;
    return preferred === 'en' ? 'en' : 'ar';
  }

  /**
   * Story 6.1 AC1 — persist-first. Renders at queue time (a render failure is
   * itself recorded as `failed`, Story 6.3 AC5) and inserts the outbox row.
   * Returns null when the dedupe key already exists (Story 6.1 AC4).
   */
  async enqueue(input: EnqueueInput): Promise<NotificationOutbox | null> {
    let subject = '';
    let bodyHtml = '';
    let renderError: string | null = null;
    if (input.prerendered) {
      subject = input.prerendered.subject;
      bodyHtml = input.prerendered.html;
    } else {
      try {
        const rendered = renderNotification(
          input.type,
          input.language,
          input.variables,
        );
        subject = rendered.subject;
        bodyHtml = rendered.html;
      } catch (err) {
        renderError = err instanceof Error ? err.message : String(err);
      }
    }

    const now = new Date();
    const row = this.outboxRepo.create({
      type: input.type,
      channel: 'email',
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      hotelId: input.hotelId ?? null,
      tenantUserId: input.tenantUserId ?? null,
      language: input.language,
      subject,
      bodyHtml,
      variables: input.variables,
      dedupeKey: input.dedupeKey ?? null,
      resendOfId: input.resendOfId ?? null,
      status: renderError ? 'failed' : 'pending',
      attemptCount: 0,
      // Grace window: the caller dispatches the first attempt itself; the
      // poller only picks this row up if that attempt never got recorded
      // (process died mid-send). Prevents a poller tick racing the
      // in-flight first send into a double delivery.
      nextAttemptAt: renderError
        ? null
        : new Date(now.getTime() + this.retryBaseMs()),
      lastError: renderError,
      attempts: renderError
        ? [{ at: now.toISOString(), ok: false, error: renderError }]
        : [],
    });

    try {
      return await this.outboxRepo.save(row);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        this.logger.debug(
          `Notification already queued (dedupe: ${input.dedupeKey}) — skipping`,
        );
        return null;
      }
      throw err;
    }
  }

  /**
   * One delivery attempt. Never throws — provider/render errors land on the
   * outbox record (Story 6.2 AC3) with exponential backoff (Story 6.1 AC2).
   */
  async attemptSend(
    row: NotificationOutbox,
    inMemory?: InMemoryBody,
  ): Promise<void> {
    if (row.status !== 'pending') return;

    let html: string;
    let redact: string[] = [];
    try {
      if (inMemory) {
        html = inMemory.html;
        redact = inMemory.redact;
      } else if (row.type === 'owner_setup_link' || row.type === 'staff_invite') {
        // The raw token lived only in the original emission's call stack
        // (Story 6.4 AC2) — a later attempt must mint a fresh one.
        const regenerated = await this.regenerateSetupLinkBody(row);
        html = regenerated.html;
        redact = regenerated.redact;
      } else {
        html = row.bodyHtml;
      }
    } catch (err) {
      // Deterministic preparation failure — retrying cannot help.
      await this.recordFailure(row, err, { terminal: true });
      return;
    }

    try {
      await this.mailDriver.send({
        to: row.recipientEmail,
        toName: row.recipientName,
        subject: row.subject,
        html,
        redact,
      });
      await this.recordSuccess(row);
    } catch (err) {
      await this.recordFailure(row, err);
    }
  }

  /** Story 6.1 AC2 — poller body: due pending records, oldest first. */
  async processDue(): Promise<number> {
    const due = await this.outboxRepo.find({
      where: { status: 'pending', nextAttemptAt: LessThanOrEqual(new Date()) },
      order: { nextAttemptAt: 'ASC' },
      take: RETRY_BATCH_SIZE,
    });
    for (const row of due) {
      await this.attemptSend(row);
    }
    return due.length;
  }

  /** Story 6.7 AC2 — paginated log with filters. */
  async findAll(query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.outboxRepo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.hotel', 'hotel')
      .orderBy('n.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (query.status) qb.andWhere('n.status = :status', { status: query.status });
    if (query.type) qb.andWhere('n.type = :type', { type: query.type });
    if (query.hotelId) {
      qb.andWhere('n.hotelId = :hotelId', { hotelId: query.hotelId });
    }
    if (query.dateFrom) {
      qb.andWhere('n.createdAt >= :dateFrom', {
        dateFrom: new Date(query.dateFrom),
      });
    }
    if (query.dateTo) {
      qb.andWhere('n.createdAt <= :dateTo', { dateTo: new Date(query.dateTo) });
    }
    if (query.search) {
      qb.andWhere(
        '(n.recipientEmail ILIKE :search OR n.recipientName ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map((row) => this.toListItem(row)),
      total,
      page,
      pageSize,
    };
  }

  /** Internal lookup — API responses go through getDetail()/toDetail(). */
  async findOne(id: string): Promise<NotificationOutbox> {
    const row = await this.outboxRepo.findOne({
      where: { id },
      relations: ['hotel'],
    });
    if (!row)
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    return row;
  }

  /**
   * Story 6.7 AC3 — rendered body + attempt timeline, shaped like the list
   * items: never the raw entity (the hotel relation would drag along
   * internal fields such as suspensionNote, and variables/dedupeKey are
   * implementation details).
   */
  async getDetail(id: string) {
    return this.toDetail(await this.findOne(id));
  }

  /**
   * Story 6.7 AC4 — resend a failed notification as a *new* outbox record
   * referencing the original. Setup links go through the regeneration flow
   * (new token, old invalidated) instead of resending the stale body.
   * Returns the shaped detail of the fresh record.
   */
  async resend(id: string, actor: Admin) {
    const original = await this.findOne(id);
    if (original.status !== 'failed') {
      throw new ConflictException({
        code: 'ONLY_FAILED_RESENDABLE',
        message: 'Only failed notifications can be resent',
      });
    }

    let fresh: NotificationOutbox | null;
    if (original.type === 'owner_setup_link') {
      if (!original.hotelId) {
        throw new ConflictException({
          code: 'NO_ASSOCIATED_HOTEL',
          message: 'Notification has no associated hotel',
        });
      }
      await this.tenantUsersService.regenerateSetupLink(
        original.hotelId,
        actor,
        { resendOfId: original.id },
      );
      // regenerateSetupLink awaits the emission (emitAsync), and the
      // listener awaits the outbox INSERT before dispatching the send —
      // so the fresh row exists here. DESC picks the newest if the same
      // original was resent before.
      fresh = await this.outboxRepo.findOne({
        where: { resendOfId: original.id },
        order: { createdAt: 'DESC' },
      });
      if (!fresh) {
        throw new ConflictException({
          code: 'ONLY_FAILED_RESENDABLE',
          message: 'Setup link was regenerated but no notification was queued',
        });
      }
    } else if (original.type === 'staff_invite') {
      // Enqueue a fresh row carrying the invitee/variables (masked body as a
      // placeholder); attemptSend then mints a new token and re-renders via the
      // regeneration path — same "old link dies" semantics as owner setup.
      fresh = await this.enqueue({
        type: 'staff_invite',
        recipientName: original.recipientName,
        recipientEmail: original.recipientEmail,
        hotelId: original.hotelId,
        tenantUserId: original.tenantUserId,
        language: original.language,
        variables: original.variables ?? {},
        dedupeKey: null,
        resendOfId: original.id,
        prerendered: { subject: original.subject, html: original.bodyHtml },
      });
      await this.attemptSend(fresh!);
    } else {
      fresh = await this.enqueue({
        type: original.type,
        recipientName: original.recipientName,
        recipientEmail: original.recipientEmail,
        hotelId: original.hotelId,
        tenantUserId: original.tenantUserId,
        language: original.language,
        variables: original.variables ?? {},
        dedupeKey: null,
        resendOfId: original.id,
      });
      // dedupeKey is null, so a unique violation is impossible here.
      await this.attemptSend(fresh!);
    }

    await this.auditLogs.log({
      action: 'notification.resent',
      entityType: 'notification',
      entityId: original.id,
      actorId: actor.id,
      metadata: { originalId: original.id, newId: fresh!.id, type: original.type },
    });
    return this.getDetail(fresh!.id);
  }

  private toListItem(row: NotificationOutbox) {
    return {
      id: row.id,
      createdAt: row.createdAt,
      type: row.type,
      channel: row.channel,
      language: row.language,
      recipientName: row.recipientName,
      recipientEmail: row.recipientEmail,
      status: row.status,
      attemptCount: row.attemptCount,
      sentAt: row.sentAt,
      resendOfId: row.resendOfId,
      hotel: row.hotel
        ? { id: row.hotel.id, nameEn: row.hotel.nameEn, nameAr: row.hotel.nameAr }
        : null,
    };
  }

  private toDetail(row: NotificationOutbox) {
    return {
      ...this.toListItem(row),
      subject: row.subject,
      bodyHtml: row.bodyHtml,
      lastError: row.lastError,
      attempts: row.attempts ?? [],
    };
  }

  /**
   * Story 6.4 AC2 retry path: mint a fresh token (old one dies), re-render,
   * refresh the persisted *masked* body, return the real body for this send.
   */
  private async regenerateSetupLinkBody(
    row: NotificationOutbox,
  ): Promise<InMemoryBody> {
    const owner = row.tenantUserId
      ? await this.tenantUsersRepo.findOne({ where: { id: row.tenantUserId } })
      : null;
    const hotel = row.hotelId
      ? await this.hotelsRepo.findOne({ where: { id: row.hotelId } })
      : null;
    if (!owner || !hotel) {
      throw new Error('Setup-link recipient or hotel no longer exists');
    }
    if (owner.status === 'active') {
      // The owner completed setup meanwhile (e.g. via the manual copy link);
      // minting a new token would needlessly reopen their account setup.
      throw new Error('Owner account is already active — setup link obsolete');
    }

    const token = await this.tenantUsersService.issueSetupToken(owner);
    const vars = {
      ...(row.variables ?? {}),
      expiresAt: formatNotificationDate(token.expiresAt, row.language, true),
    };
    // Both setup and staff-invite links use the same URL + two-pass masking;
    // only the template differs.
    const render =
      row.type === 'staff_invite' ? renderStaffInviteEmail : renderSetupLinkEmail;
    const { masked, real, redact } = render(
      row.language,
      vars,
      (t) => this.tenantUsersService.buildSetupLink(hotel.slug, t),
      token.raw,
    );
    row.subject = masked.subject;
    row.bodyHtml = masked.html;
    row.variables = vars;
    await this.outboxRepo.save(row);
    return { html: real.html, redact };
  }

  private async recordSuccess(row: NotificationOutbox): Promise<void> {
    const now = new Date();
    row.status = 'sent';
    row.sentAt = now;
    row.attemptCount += 1;
    row.lastError = null;
    row.nextAttemptAt = null;
    row.attempts = [
      ...(row.attempts ?? []),
      { at: now.toISOString(), ok: true, error: null },
    ];
    await this.outboxRepo.save(row);
  }

  private async recordFailure(
    row: NotificationOutbox,
    err: unknown,
    opts: { terminal?: boolean } = {},
  ): Promise<void> {
    const now = new Date();
    const message = err instanceof Error ? err.message : String(err);
    row.attemptCount += 1;
    row.lastError = message;
    row.attempts = [
      ...(row.attempts ?? []),
      { at: now.toISOString(), ok: false, error: message },
    ];
    if (opts.terminal || row.attemptCount >= this.maxAttempts()) {
      row.status = 'failed';
      row.nextAttemptAt = null;
    } else {
      // Exponential backoff: base, 2×base, 4×base… (Story 6.1 AC2)
      row.nextAttemptAt = new Date(
        now.getTime() + this.retryBaseMs() * 2 ** (row.attemptCount - 1),
      );
    }
    await this.outboxRepo.save(row);
    this.logger.warn(
      `Notification ${row.id} (${row.type}) attempt ${row.attemptCount} failed: ${message}`,
    );
  }

  private maxAttempts(): number {
    return parseInt(this.config.get('NOTIFICATION_MAX_ATTEMPTS', '3'), 10);
  }

  private retryBaseMs(): number {
    return parseInt(this.config.get('NOTIFICATION_RETRY_BASE_MS', '60000'), 10);
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError &&
      (err.driverError as { code?: string } | undefined)?.code === '23505'
    );
  }
}
