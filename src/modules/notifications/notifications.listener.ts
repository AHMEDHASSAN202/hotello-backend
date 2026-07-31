import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { dedupeKeys } from './dedupe-keys';
import {
  HotelReactivatedEvent,
  HotelSuspendedEvent,
  NOTIFICATION_EVENTS,
  OwnerSetupLinkRequestedEvent,
  StaffInviteRequestedEvent,
  StaffWelcomeRequestedEvent,
  TenantPasswordResetRequestedEvent,
  TrialCountdownEvent,
  TrialExpiredEvent,
} from './notification-events';
import { NotificationLanguage } from './notifications.constants';
import { NotificationOutbox } from './notification.entity';
import { InMemoryBody, NotificationsService } from './notifications.service';
import {
  formatNotificationDate,
  renderResetLinkEmail,
  renderSetupLinkEmail,
  renderStaffInviteEmail,
} from './templates/render';

/**
 * Story 6.1 AC3 — the notifications module owns all listening, rendering and
 * sending. Every handler swallows its own errors: a notification failure must
 * never propagate into the emitting business operation.
 *
 * Handlers are awaited by the emitter (safeEmit → emitAsync) only up to the
 * outbox INSERT — the actual send is dispatched in the background so provider
 * latency never blocks the business request. The retry poller backstops any
 * send the process drops.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly tenantUsersService: TenantUsersService,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
  ) {}

  @OnEvent(NOTIFICATION_EVENTS.OWNER_SETUP_LINK_REQUESTED)
  async onOwnerSetupLinkRequested(event: OwnerSetupLinkRequestedEvent) {
    try {
      // Spec note 8 — the single resolution point, also for setup links.
      const language = this.notifications.resolveLanguage({
        defaultLanguage: event.language,
      });
      const vars = {
        hotelName: language === 'ar' ? event.hotelNameAr : event.hotelNameEn,
        ownerName: event.ownerName,
        expiresAt: formatNotificationDate(event.expiresAt, language, true),
      };
      // Two renders (Story 6.4 AC2): the masked one is persisted, the real
      // one exists only in this call stack and goes straight to the driver.
      const { masked, real, redact } = renderSetupLinkEmail(
        language,
        vars,
        (token) => this.tenantUsersService.buildSetupLink(event.slug, token),
        event.rawToken,
      );

      const row = await this.notifications.enqueue({
        type: 'owner_setup_link',
        recipientName: event.ownerName,
        recipientEmail: event.ownerEmail,
        hotelId: event.hotelId,
        tenantUserId: event.ownerId,
        language,
        variables: vars,
        dedupeKey: dedupeKeys.ownerSetupLink(event.ownerId, event.rawToken),
        resendOfId: event.resendOfId ?? null,
        prerendered: masked,
      });
      if (row) {
        this.dispatchSend(row, NOTIFICATION_EVENTS.OWNER_SETUP_LINK_REQUESTED, {
          html: real.html,
          redact,
        });
      }
    } catch (err) {
      this.logError(NOTIFICATION_EVENTS.OWNER_SETUP_LINK_REQUESTED, err);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.STAFF_INVITE_REQUESTED)
  async onStaffInviteRequested(event: StaffInviteRequestedEvent) {
    try {
      const language = this.notifications.resolveLanguage({
        defaultLanguage: event.language,
      });
      const vars = {
        hotelName: language === 'ar' ? event.hotelNameAr : event.hotelNameEn,
        userName: event.userName,
        roleName: language === 'ar' ? event.roleNameAr : event.roleNameEn,
        expiresAt: formatNotificationDate(event.expiresAt, language, true),
      };
      // Same two-pass secret handling as owner setup links.
      const { masked, real, redact } = renderStaffInviteEmail(
        language,
        vars,
        (token) => this.tenantUsersService.buildSetupLink(event.slug, token),
        event.rawToken,
      );

      const row = await this.notifications.enqueue({
        type: 'staff_invite',
        recipientName: event.userName,
        recipientEmail: event.userEmail,
        hotelId: event.hotelId,
        tenantUserId: event.tenantUserId,
        language,
        variables: vars,
        dedupeKey: dedupeKeys.staffInvite(event.tenantUserId, event.rawToken),
        resendOfId: event.resendOfId ?? null,
        prerendered: masked,
      });
      if (row) {
        this.dispatchSend(row, NOTIFICATION_EVENTS.STAFF_INVITE_REQUESTED, {
          html: real.html,
          redact,
        });
      }
    } catch (err) {
      this.logError(NOTIFICATION_EVENTS.STAFF_INVITE_REQUESTED, err);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.STAFF_WELCOME_REQUESTED)
  async onStaffWelcomeRequested(event: StaffWelcomeRequestedEvent) {
    try {
      const language = this.notifications.resolveLanguage({
        defaultLanguage: event.language,
      });
      // No secret in this email (login URL + username only) — a single plain
      // render, persisted and sent as-is.
      const row = await this.notifications.enqueue({
        type: 'staff_welcome',
        recipientName: event.userName,
        recipientEmail: event.userEmail,
        hotelId: event.hotelId,
        tenantUserId: event.tenantUserId,
        language,
        variables: {
          hotelName: language === 'ar' ? event.hotelNameAr : event.hotelNameEn,
          userName: event.userName,
          username: event.username,
          loginUrl: this.tenantUsersService.buildLoginLink(event.slug),
        },
        dedupeKey: dedupeKeys.staffWelcome(event.tenantUserId),
      });
      if (row) {
        this.dispatchSend(row, NOTIFICATION_EVENTS.STAFF_WELCOME_REQUESTED);
      }
    } catch (err) {
      this.logError(NOTIFICATION_EVENTS.STAFF_WELCOME_REQUESTED, err);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.TENANT_PASSWORD_RESET_REQUESTED)
  async onTenantPasswordResetRequested(
    event: TenantPasswordResetRequestedEvent,
  ) {
    try {
      const language = this.notifications.resolveLanguage({
        defaultLanguage: event.language,
      });
      const vars = {
        hotelName: language === 'ar' ? event.hotelNameAr : event.hotelNameEn,
        userName: event.userName,
        expiresAt: formatNotificationDate(event.expiresAt, language, true),
      };
      // Same two-pass secret handling as setup links: masked persisted, real sent.
      const { masked, real, redact } = renderResetLinkEmail(
        language,
        vars,
        (token) => this.tenantUsersService.buildResetLink(event.slug, token),
        event.rawToken,
      );

      const row = await this.notifications.enqueue({
        type: 'tenant_password_reset',
        recipientName: event.userName,
        recipientEmail: event.userEmail,
        hotelId: event.hotelId,
        tenantUserId: event.tenantUserId,
        language,
        variables: vars,
        dedupeKey: dedupeKeys.tenantPasswordReset(
          event.tenantUserId,
          event.rawToken,
        ),
        prerendered: masked,
      });
      if (row) {
        this.dispatchSend(
          row,
          NOTIFICATION_EVENTS.TENANT_PASSWORD_RESET_REQUESTED,
          { html: real.html, redact },
        );
      }
    } catch (err) {
      this.logError(NOTIFICATION_EVENTS.TENANT_PASSWORD_RESET_REQUESTED, err);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.TRIAL_COUNTDOWN)
  async onTrialCountdown(event: TrialCountdownEvent) {
    try {
      const target = await this.loadHotelAndOwner(event.hotelId);
      if (!target) return;
      const { hotel, owner, ownerEmail, language } = target;
      const row = await this.notifications.enqueue({
        type: 'trial_countdown',
        recipientName: owner.name,
        recipientEmail: ownerEmail,
        hotelId: hotel.id,
        tenantUserId: owner.id,
        language,
        variables: {
          hotelName: language === 'ar' ? hotel.nameAr : hotel.nameEn,
          ownerName: owner.name,
          daysRemaining: event.daysRemaining,
          trialEndsAt: formatNotificationDate(event.trialEndsAt, language),
        },
        dedupeKey: dedupeKeys.trialCountdown(
          event.subscriptionId,
          event.threshold,
          event.trialEndsAt,
        ),
      });
      if (row) this.dispatchSend(row, NOTIFICATION_EVENTS.TRIAL_COUNTDOWN);
    } catch (err) {
      this.logError(NOTIFICATION_EVENTS.TRIAL_COUNTDOWN, err);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.TRIAL_EXPIRED)
  async onTrialExpired(event: TrialExpiredEvent) {
    try {
      const target = await this.loadHotelAndOwner(event.hotelId);
      if (!target) return;
      const { hotel, owner, ownerEmail, language } = target;
      const row = await this.notifications.enqueue({
        type: 'trial_expired',
        recipientName: owner.name,
        recipientEmail: ownerEmail,
        hotelId: hotel.id,
        tenantUserId: owner.id,
        language,
        variables: {
          hotelName: language === 'ar' ? hotel.nameAr : hotel.nameEn,
          ownerName: owner.name,
        },
        dedupeKey: dedupeKeys.trialExpired(
          event.subscriptionId,
          event.trialEndsAt,
        ),
      });
      if (row) this.dispatchSend(row, NOTIFICATION_EVENTS.TRIAL_EXPIRED);
    } catch (err) {
      this.logError(NOTIFICATION_EVENTS.TRIAL_EXPIRED, err);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.HOTEL_SUSPENDED)
  async onHotelSuspended(event: HotelSuspendedEvent) {
    try {
      const target = await this.loadHotelAndOwner(event.hotelId);
      if (!target) return;
      const { hotel, owner, ownerEmail, language } = target;
      const row = await this.notifications.enqueue({
        type: 'hotel_suspended',
        recipientName: owner.name,
        recipientEmail: ownerEmail,
        hotelId: hotel.id,
        tenantUserId: owner.id,
        language,
        variables: {
          hotelName: language === 'ar' ? hotel.nameAr : hotel.nameEn,
          ownerName: owner.name,
          // Category only — the internal note is never included (6.6 AC1).
          reason: event.reason,
        },
        dedupeKey: dedupeKeys.hotelSuspended(event.hotelId, event.suspendedAt),
      });
      if (row) this.dispatchSend(row, NOTIFICATION_EVENTS.HOTEL_SUSPENDED);
    } catch (err) {
      this.logError(NOTIFICATION_EVENTS.HOTEL_SUSPENDED, err);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.HOTEL_REACTIVATED)
  async onHotelReactivated(event: HotelReactivatedEvent) {
    try {
      const target = await this.loadHotelAndOwner(event.hotelId);
      if (!target) return;
      const { hotel, owner, ownerEmail, language } = target;
      const row = await this.notifications.enqueue({
        type: 'hotel_reactivated',
        recipientName: owner.name,
        recipientEmail: ownerEmail,
        hotelId: hotel.id,
        tenantUserId: owner.id,
        language,
        variables: {
          hotelName: language === 'ar' ? hotel.nameAr : hotel.nameEn,
          ownerName: owner.name,
        },
        dedupeKey: dedupeKeys.hotelReactivated(event.hotelId, event.occurredAt),
      });
      if (row) this.dispatchSend(row, NOTIFICATION_EVENTS.HOTEL_REACTIVATED);
    } catch (err) {
      this.logError(NOTIFICATION_EVENTS.HOTEL_REACTIVATED, err);
    }
  }

  private async loadHotelAndOwner(hotelId: string): Promise<{
    hotel: Hotel;
    owner: TenantUser;
    /** Narrowed non-null — owners always have an email (entity invariant). */
    ownerEmail: string;
    language: NotificationLanguage;
  } | null> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) {
      this.logger.warn(`Hotel ${hotelId} not found — notification skipped`);
      return null;
    }
    const owner = await this.tenantUsersRepo.findOne({
      where: { hotelId, role: { isSystem: true } },
      relations: ['role'],
    });
    if (!owner || !owner.email) {
      this.logger.warn(
        `Hotel ${hotelId} has no emailable owner account — notification skipped`,
      );
      return null;
    }
    return {
      hotel,
      owner,
      ownerEmail: owner.email,
      language: this.notifications.resolveLanguage(hotel),
    };
  }

  /**
   * Fire the delivery attempt without blocking the emitting request —
   * attemptSend records its own outcome; anything it drops (process death,
   * bookkeeping error) is picked up by the retry poller.
   */
  private dispatchSend(
    row: NotificationOutbox,
    event: string,
    inMemory?: InMemoryBody,
  ): void {
    void Promise.resolve(this.notifications.attemptSend(row, inMemory)).catch(
      (err) => this.logError(event, err),
    );
  }

  private logError(event: string, err: unknown) {
    this.logger.error(
      `Listener for ${event} failed: ${err instanceof Error ? err.stack : err}`,
    );
  }
}
