import { esc } from './escape';
import { ctaButton } from './layout';
import { NotificationTemplate } from './template.types';

export interface StaffWelcomeVars {
  hotelName: string;
  userName: string;
  username: string;
  /** Login page URL — carries no secret (never the password). */
  loginUrl: string;
}

/**
 * Story 9.7 AC7 — optional welcome email for a directly-created account that
 * has an email. Carries the login URL and username so the person knows how to
 * sign in; the temporary password is NEVER included (handed over out-of-band).
 */
export const staffWelcomeTemplate: NotificationTemplate<StaffWelcomeVars> = {
  requiredVars: ['hotelName', 'userName', 'username', 'loginUrl'],
  ar: {
    subject: (v) => `تم إنشاء حسابك على ${v.hotelName} — منصة GXP`,
    content: (v) => `
      <p>مرحباً ${esc(v.userName)}،</p>
      <p>تم إنشاء حساب لك للعمل في ${esc(v.hotelName)} على منصة GXP. اسم المستخدم الخاص بك هو <strong>${esc(v.username)}</strong>.</p>
      <p>سيتم تزويدك بكلمة مرور مؤقتة بشكل منفصل، وسيُطلب منك تغييرها عند أول تسجيل دخول.</p>
      ${ctaButton(v.loginUrl, 'تسجيل الدخول')}
      <p>إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.</p>`,
  },
  en: {
    subject: (v) => `Your account for ${v.hotelName} is ready — GXP`,
    content: (v) => `
      <p>Hello ${esc(v.userName)},</p>
      <p>An account has been created for you to work at ${esc(v.hotelName)} on the GXP platform. Your username is <strong>${esc(v.username)}</strong>.</p>
      <p>You'll receive a temporary password separately, and you'll be asked to change it on your first sign-in.</p>
      ${ctaButton(v.loginUrl, 'Sign in')}
      <p>If you were not expecting this email, you can safely ignore it.</p>`,
  },
};
