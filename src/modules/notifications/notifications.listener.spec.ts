import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import {
  OwnerSetupLinkRequestedEvent,
  StaffInviteRequestedEvent,
} from './notification-events';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let notifications: {
    enqueue: jest.Mock;
    attemptSend: jest.Mock;
    resolveLanguage: jest.Mock;
  };
  let hotelsRepo: { findOne: jest.Mock };
  let tenantUsersRepo: { findOne: jest.Mock };

  const hotel = {
    id: 'hotel-1',
    nameEn: 'Nile Grand',
    nameAr: 'نايل جراند',
    slug: 'nile-grand',
    defaultLanguage: 'ar',
  } as Hotel;
  const owner = {
    id: 'owner-1',
    hotelId: 'hotel-1',
    name: 'Owner One',
    email: 'owner@nilegrand.example',
    role: { id: 'role-owner', isSystem: true, permissions: ['*'] },
  } as unknown as TenantUser;

  const staffInviteEvent = (
    overrides: Partial<StaffInviteRequestedEvent> = {},
  ): StaffInviteRequestedEvent => ({
    hotelId: 'hotel-1',
    tenantUserId: 'staff-1',
    userName: 'Staff One',
    userEmail: 'staff@nilegrand.example',
    roleNameEn: 'Manager',
    roleNameAr: 'مدير',
    hotelNameEn: 'Nile Grand',
    hotelNameAr: 'نايل جراند',
    slug: 'nile-grand',
    language: 'en',
    rawToken: 'RAW-SECRET-TOKEN',
    expiresAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  });

  const setupEvent = (
    overrides: Partial<OwnerSetupLinkRequestedEvent> = {},
  ): OwnerSetupLinkRequestedEvent => ({
    hotelId: 'hotel-1',
    ownerId: 'owner-1',
    ownerName: 'Owner One',
    ownerEmail: 'owner@nilegrand.example',
    hotelNameEn: 'Nile Grand',
    hotelNameAr: 'نايل جراند',
    slug: 'nile-grand',
    language: 'en',
    rawToken: 'RAW-SECRET-TOKEN',
    expiresAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    notifications = {
      enqueue: jest.fn(async (input) => ({ id: 'notif-1', ...input })),
      attemptSend: jest.fn().mockResolvedValue(undefined),
      resolveLanguage: jest.fn(
        (h: Pick<Hotel, 'defaultLanguage'>) =>
          h.defaultLanguage === 'en' ? 'en' : 'ar',
      ),
    };
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(hotel) };
    tenantUsersRepo = { findOne: jest.fn().mockResolvedValue(owner) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        { provide: NotificationsService, useValue: notifications },
        {
          provide: TenantUsersService,
          useValue: {
            buildSetupLink: jest.fn(
              (slug: string, raw: string) =>
                `https://${slug}.gxp.example/setup?token=${raw}`,
            ),
          },
        },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(TenantUser), useValue: tenantUsersRepo },
      ],
    }).compile();

    listener = moduleRef.get(NotificationsListener);
  });

  describe('decoupled emission (6.1 AC3)', () => {
    it('never rethrows — an internal failure cannot reach the emitting service', async () => {
      notifications.enqueue.mockRejectedValue(new Error('database down'));

      await expect(
        listener.onOwnerSetupLinkRequested(setupEvent()),
      ).resolves.toBeUndefined();
      await expect(
        listener.onHotelSuspended({
          hotelId: 'hotel-1',
          reason: 'non_payment',
          suspendedAt: new Date(),
        }),
      ).resolves.toBeUndefined();
    });

    it('skips gracefully when the hotel or owner no longer exists', async () => {
      tenantUsersRepo.findOne.mockResolvedValue(null);
      await listener.onTrialExpired({
        subscriptionId: 'sub-1',
        hotelId: 'hotel-1',
        trialEndsAt: new Date(),
      });
      expect(notifications.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('owner setup link email (6.4)', () => {
    it('persists only masked content — the raw token never reaches a stored field (AC2)', async () => {
      await listener.onOwnerSetupLinkRequested(setupEvent());

      const input = notifications.enqueue.mock.calls[0][0];
      expect(input.type).toBe('owner_setup_link');
      expect(input.prerendered.html).toContain('********');
      expect(input.prerendered.html).not.toContain('RAW-SECRET-TOKEN');
      expect(input.prerendered.subject).not.toContain('RAW-SECRET-TOKEN');
      expect(JSON.stringify(input.variables)).not.toContain('RAW-SECRET-TOKEN');
      expect(input.variables).not.toHaveProperty('setupUrl');
    });

    it('hands the real body with the token to the send attempt, flagged for redaction (AC2)', async () => {
      await listener.onOwnerSetupLinkRequested(setupEvent());

      const [row, inMemory] = notifications.attemptSend.mock.calls[0];
      expect(row.id).toBe('notif-1');
      expect(inMemory.html).toContain('RAW-SECRET-TOKEN');
      expect(inMemory.redact).toEqual(['RAW-SECRET-TOKEN']);
    });

    it("follows the hotel's language and keys dedupe per token issuance (AC1)", async () => {
      await listener.onOwnerSetupLinkRequested(setupEvent({ language: 'ar' }));
      await listener.onOwnerSetupLinkRequested(
        setupEvent({ language: 'ar', rawToken: 'ANOTHER-TOKEN' }),
      );

      const [first, second] = notifications.enqueue.mock.calls.map(
        (c) => c[0],
      );
      expect(first.language).toBe('ar');
      expect(first.variables.hotelName).toBe('نايل جراند');
      expect(first.dedupeKey).toMatch(/^owner_setup_link:owner-1:[0-9a-f]{12}$/);
      // A new issuance (regeneration) gets a new key → a new email goes out.
      expect(second.dedupeKey).not.toBe(first.dedupeKey);
    });

    it('carries resendOfId through to the outbox row (6.7 AC4)', async () => {
      await listener.onOwnerSetupLinkRequested(
        setupEvent({ resendOfId: 'notif-0' }),
      );
      expect(notifications.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ resendOfId: 'notif-0' }),
      );
    });

    it('skips the send when the dedupe key already exists', async () => {
      notifications.enqueue.mockResolvedValue(null);
      await listener.onOwnerSetupLinkRequested(setupEvent());
      expect(notifications.attemptSend).not.toHaveBeenCalled();
    });
  });

  describe('staff invite email (9.3 AC3)', () => {
    it('persists masked content and sends the real token, keyed per issuance', async () => {
      await listener.onStaffInviteRequested(staffInviteEvent());

      const input = notifications.enqueue.mock.calls[0][0];
      expect(input.type).toBe('staff_invite');
      expect(input.recipientEmail).toBe('staff@nilegrand.example');
      expect(input.prerendered.html).toContain('********');
      expect(input.prerendered.html).not.toContain('RAW-SECRET-TOKEN');
      expect(input.variables).not.toHaveProperty('setupUrl');
      expect(input.dedupeKey).toMatch(/^staff_invite:staff-1:[0-9a-f]{12}$/);

      const [, inMemory] = notifications.attemptSend.mock.calls[0];
      expect(inMemory.html).toContain('RAW-SECRET-TOKEN');
      expect(inMemory.redact).toEqual(['RAW-SECRET-TOKEN']);
    });

    it('names the role in the invitee-facing content', async () => {
      await listener.onStaffInviteRequested(staffInviteEvent({ language: 'en' }));
      const input = notifications.enqueue.mock.calls[0][0];
      expect(input.variables.roleName).toBe('Manager');
    });
  });

  describe('trial countdown & expiry notices (6.5)', () => {
    it('queues one countdown email keyed on threshold + trial end date (AC2/AC4)', async () => {
      // Catch-up shape: the 7-day *notice* fires with 6 actual days left.
      await listener.onTrialCountdown({
        subscriptionId: 'sub-1',
        hotelId: 'hotel-1',
        threshold: 7,
        daysRemaining: 6,
        trialEndsAt: new Date('2026-08-15T00:00:00Z'),
      });

      expect(notifications.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trial_countdown',
          recipientEmail: 'owner@nilegrand.example',
          language: 'ar',
          // The tier keys the dedupe…
          dedupeKey: 'trial_countdown:sub-1:7:2026-08-15',
          // …but the email shows the real days remaining (AC1).
          variables: expect.objectContaining({ daysRemaining: 6 }),
        }),
      );
      expect(notifications.attemptSend).toHaveBeenCalled();
    });

    it('queues the expiry notice once per trial end (AC3)', async () => {
      const event = {
        subscriptionId: 'sub-1',
        hotelId: 'hotel-1',
        trialEndsAt: new Date('2026-08-15T00:00:00Z'),
      };
      await listener.onTrialExpired(event);
      notifications.enqueue.mockResolvedValue(null); // dedupe hit on re-emit
      await listener.onTrialExpired(event);

      expect(notifications.enqueue).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: 'trial_expired',
          dedupeKey: 'trial_expired:sub-1:2026-08-15',
        }),
      );
      // Second emission deduped → only the first send happened.
      expect(notifications.attemptSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('suspension / reactivation notices (6.6)', () => {
    it('sends the suspension category in the hotel language — the internal note never appears (AC1/AC3)', async () => {
      await listener.onHotelSuspended({
        hotelId: 'hotel-1',
        reason: 'policy_violation',
        suspendedAt: new Date('2026-07-28T10:00:00Z'),
      });

      const input = notifications.enqueue.mock.calls[0][0];
      expect(input.type).toBe('hotel_suspended');
      expect(input.language).toBe('ar');
      expect(input.variables.reason).toBe('policy_violation');
      expect(input.variables).not.toHaveProperty('note');
      expect(input.dedupeKey).toBe(
        'hotel_suspended:hotel-1:2026-07-28T10:00:00.000Z',
      );
    });

    it('queues the reactivation confirmation keyed per occurrence (AC2)', async () => {
      await listener.onHotelReactivated({
        hotelId: 'hotel-1',
        occurredAt: new Date('2026-07-29T09:00:00Z'),
      });

      expect(notifications.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'hotel_reactivated',
          dedupeKey: 'hotel_reactivated:hotel-1:2026-07-29T09:00:00.000Z',
        }),
      );
      expect(notifications.attemptSend).toHaveBeenCalled();
    });
  });
});
