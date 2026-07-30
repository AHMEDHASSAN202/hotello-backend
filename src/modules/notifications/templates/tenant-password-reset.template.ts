import { esc } from './escape';
import { ctaButton } from './layout';
import { NotificationTemplate } from './template.types';

export interface TenantPasswordResetVars {
  hotelName: string;
  userName: string;
  /** Full reset URL — carries the raw token; never persisted unmasked. */
  resetLink: string;
  /** Pre-formatted expiry, e.g. "2026-07-31 14:00 UTC". */
  expiresAt: string;
}

export const tenantPasswordResetTemplate: NotificationTemplate<TenantPasswordResetVars> =
  {
    requiredVars: ['hotelName', 'userName', 'resetLink', 'expiresAt'],
    ar: {
      subject: (v) => `إعادة تعيين كلمة المرور لحساب ${v.hotelName} على منصة GXP`,
      content: (v) => `
        <p>مرحباً ${esc(v.userName)}،</p>
        <p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في ${esc(v.hotelName)}. لتعيين كلمة مرور جديدة، اضغط على الزر التالي:</p>
        ${ctaButton(v.resetLink, 'إعادة تعيين كلمة المرور')}
        <p>هذا الرابط صالح للاستخدام مرة واحدة فقط وتنتهي صلاحيته في ${esc(v.expiresAt)}.</p>
        <p>إذا لم تطلب إعادة التعيين، يمكنك تجاهل هذه الرسالة بأمان — لن يتغير شيء.</p>`,
    },
    en: {
      subject: (v) => `Reset your password for ${v.hotelName} on GXP`,
      content: (v) => `
        <p>Hello ${esc(v.userName)},</p>
        <p>We received a request to reset the password for your account at ${esc(v.hotelName)}. To choose a new password, use the button below:</p>
        ${ctaButton(v.resetLink, 'Reset password')}
        <p>This link can be used once and expires on ${esc(v.expiresAt)}.</p>
        <p>If you didn't request a reset, you can safely ignore this email — nothing will change.</p>`,
    },
  };
