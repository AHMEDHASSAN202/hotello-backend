import {
  NOTIFICATION_TYPES,
  NotificationLanguage,
  NotificationType,
} from '../notifications.constants';
import {
  MissingTemplateVariableError,
  renderNotification,
} from './render';

const FULL_VARS: Record<NotificationType, Record<string, unknown>> = {
  owner_setup_link: {
    hotelName: 'Nile Grand',
    ownerName: 'Owner One',
    setupUrl: 'https://nile-grand.gxp.example/setup?token=abc',
    expiresAt: '1 Aug 2026, 14:00',
  },
  staff_invite: {
    hotelName: 'Nile Grand',
    userName: 'Staff One',
    roleName: 'Manager',
    setupUrl: 'https://nile-grand.gxp.example/setup?token=abc',
    expiresAt: '1 Aug 2026, 14:00',
  },
  staff_welcome: {
    hotelName: 'Nile Grand',
    userName: 'Staff One',
    username: 'staff.one',
    loginUrl: 'https://nile-grand.gxp.example/login',
  },
  tenant_password_reset: {
    hotelName: 'Nile Grand',
    userName: 'Owner One',
    resetLink: 'https://nile-grand.gxp.example/reset-password?token=abc',
    expiresAt: '1 Aug 2026, 14:00',
  },
  trial_countdown: {
    hotelName: 'Nile Grand',
    ownerName: 'Owner One',
    daysRemaining: 7,
    trialEndsAt: '15 Aug 2026',
  },
  trial_expired: { hotelName: 'Nile Grand', ownerName: 'Owner One' },
  hotel_suspended: {
    hotelName: 'Nile Grand',
    ownerName: 'Owner One',
    reason: 'non_payment',
  },
  hotel_reactivated: { hotelName: 'Nile Grand', ownerName: 'Owner One' },
  stay_code: {
    hotelName: 'Nile Grand',
    guestName: 'Guest One',
    roomNumber: '101A',
    code: '123456',
    guestAppUrl: 'https://guest.gxp.example/nile-grand',
    checkOutDate: '25 Aug 2026',
  },
};

describe('bilingual templates (6.3)', () => {
  const languages: NotificationLanguage[] = ['ar', 'en'];

  it.each(
    NOTIFICATION_TYPES.flatMap((type) =>
      languages.map((lang) => [type, lang] as const),
    ),
  )('renders %s in %s with brand layout and inline styles (AC2/AC3/AC4)', (type, lang) => {
    const { subject, html } = renderNotification(type, lang, FULL_VARS[type]);

    expect(subject.length).toBeGreaterThan(0);
    // Email-client-safe shell: table layout, inline CSS, no external sheets.
    expect(html).toContain('<table');
    expect(html).not.toContain('<link');
    expect(html).toContain('#0E2A47');
    expect(html).toContain('#C8A24A');
    expect(html).toContain(
      lang === 'ar' ? 'dir="rtl"' : 'dir="ltr"',
    );
  });

  it('the countdown is one template parameterized by days remaining (AC4)', () => {
    const seven = renderNotification('trial_countdown', 'en', {
      ...FULL_VARS.trial_countdown,
      daysRemaining: 7,
    });
    const one = renderNotification('trial_countdown', 'en', {
      ...FULL_VARS.trial_countdown,
      daysRemaining: 1,
    });
    expect(seven.subject).toContain('7 days');
    expect(one.subject).toContain('1 day left');
  });

  it('the suspension email carries the localized reason category, never free text (6.6 AC1)', () => {
    const en = renderNotification('hotel_suspended', 'en', {
      ...FULL_VARS.hotel_suspended,
    });
    expect(en.html).toContain('non-payment');
    const ar = renderNotification('hotel_suspended', 'ar', {
      ...FULL_VARS.hotel_suspended,
    });
    expect(ar.html).toContain('عدم سداد المستحقات');
  });

  it('escapes interpolated names so HTML in onboarding input cannot inject markup', () => {
    const { html } = renderNotification('trial_countdown', 'en', {
      ...FULL_VARS.trial_countdown,
      hotelName: '<script>alert(1)</script>',
      ownerName: '"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects non-http(s) URLs in the setup-link button (no javascript: payloads)', () => {
    const { html } = renderNotification('owner_setup_link', 'en', {
      ...FULL_VARS.owner_setup_link,
      setupUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).toContain('href="#"');
  });

  it('the staff invite names the role in both languages (9.3 AC3)', () => {
    const en = renderNotification('staff_invite', 'en', FULL_VARS.staff_invite);
    expect(en.html).toContain('Manager');
    expect(en.subject).toContain('Nile Grand');
    const ar = renderNotification('staff_invite', 'ar', {
      ...FULL_VARS.staff_invite,
      roleName: 'مدير',
    });
    expect(ar.html).toContain('مدير');
  });

  it('escapes the role name in the staff invite (no markup injection)', () => {
    const { html } = renderNotification('staff_invite', 'en', {
      ...FULL_VARS.staff_invite,
      roleName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('fails loudly, naming every missing variable (AC5)', () => {
    expect(() =>
      renderNotification('owner_setup_link', 'en', {
        hotelName: 'Nile Grand',
      }),
    ).toThrow(MissingTemplateVariableError);
    expect(() =>
      renderNotification('owner_setup_link', 'en', { hotelName: 'X' }),
    ).toThrow(/ownerName, setupUrl, expiresAt/);
  });
});
