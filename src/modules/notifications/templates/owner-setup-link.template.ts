import { esc } from './escape';
import { ctaButton } from './layout';
import { NotificationTemplate } from './template.types';

export interface OwnerSetupLinkVars {
  hotelName: string;
  ownerName: string;
  /** Full setup URL — carries the raw token; never persisted unmasked. */
  setupUrl: string;
  /** Pre-formatted expiry, e.g. "2026-07-31 14:00 UTC". */
  expiresAt: string;
}

export const ownerSetupLinkTemplate: NotificationTemplate<OwnerSetupLinkVars> =
  {
    requiredVars: ['hotelName', 'ownerName', 'setupUrl', 'expiresAt'],
    ar: {
      subject: (v) => `تفعيل حسابك لإدارة ${v.hotelName} على منصة GXP`,
      content: (v) => `
        <p>مرحباً ${esc(v.ownerName)}،</p>
        <p>تم إنشاء حساب ${esc(v.hotelName)} على منصة GXP لإدارة تجربة النزلاء. لتفعيل حسابك وتعيين كلمة المرور، اضغط على الزر التالي:</p>
        ${ctaButton(v.setupUrl, 'تفعيل الحساب')}
        <p>هذا الرابط صالح للاستخدام مرة واحدة فقط وتنتهي صلاحيته في ${esc(v.expiresAt)}.</p>
        <p>إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.</p>`,
    },
    en: {
      subject: (v) => `Activate your account for ${v.hotelName} on GXP`,
      content: (v) => `
        <p>Hello ${esc(v.ownerName)},</p>
        <p>An account for ${esc(v.hotelName)} has been created on the GXP Guest Experience Platform. To activate your account and set your password, use the button below:</p>
        ${ctaButton(v.setupUrl, 'Activate account')}
        <p>This link can be used once and expires on ${esc(v.expiresAt)}.</p>
        <p>If you were not expecting this email, you can safely ignore it.</p>`,
    },
  };
