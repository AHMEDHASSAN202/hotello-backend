import { esc } from './escape';
import { ctaButton } from './layout';
import { NotificationTemplate } from './template.types';

export interface StaffInviteVars {
  hotelName: string;
  userName: string;
  roleName: string;
  /** Full setup URL — carries the raw token; never persisted unmasked. */
  setupUrl: string;
  /** Pre-formatted expiry, e.g. "2026-07-31 14:00 UTC". */
  expiresAt: string;
}

export const staffInviteTemplate: NotificationTemplate<StaffInviteVars> = {
  requiredVars: ['hotelName', 'userName', 'roleName', 'setupUrl', 'expiresAt'],
  ar: {
    subject: (v) => `دعوة للانضمام إلى فريق ${v.hotelName} على منصة GXP`,
    content: (v) => `
      <p>مرحباً ${esc(v.userName)}،</p>
      <p>تمت دعوتك للانضمام إلى فريق ${esc(v.hotelName)} على منصة GXP بصفة "${esc(v.roleName)}". لتفعيل حسابك وتعيين كلمة المرور، اضغط على الزر التالي:</p>
      ${ctaButton(v.setupUrl, 'تفعيل الحساب')}
      <p>هذا الرابط صالح للاستخدام مرة واحدة فقط وتنتهي صلاحيته في ${esc(v.expiresAt)}.</p>
      <p>إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.</p>`,
  },
  en: {
    subject: (v) => `You're invited to join ${v.hotelName} on GXP`,
    content: (v) => `
      <p>Hello ${esc(v.userName)},</p>
      <p>You have been invited to join the ${esc(v.hotelName)} team on the GXP Guest Experience Platform as "${esc(v.roleName)}". To activate your account and set your password, use the button below:</p>
      ${ctaButton(v.setupUrl, 'Activate account')}
      <p>This link can be used once and expires on ${esc(v.expiresAt)}.</p>
      <p>If you were not expecting this email, you can safely ignore it.</p>`,
  },
};
