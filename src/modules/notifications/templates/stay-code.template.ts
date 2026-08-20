import { esc, safeUrl } from './escape';
import { ctaButton } from './layout';
import { NotificationTemplate } from './template.types';

/**
 * Epic 13, Story 13.1 AC4 — the guest's stay code, sent when the front desk
 * captured an email at check-in. The code is a secret: rendered two-pass
 * (masked copy persisted, real copy sent) like every secret-bearing email.
 * AR/EN today; the 7 guest languages arrive with the Guest App localization
 * epic (resolveGuestEmailLanguage is the expansion point).
 */
export interface StayCodeVars {
  hotelName: string;
  guestName: string;
  roomNumber: string;
  /** The 6-digit stay code — REDACTION_MASK in the persisted render. */
  code: string;
  /** Guest App entry link for the hotel (`/{slug}`). */
  guestAppUrl: string;
  /** Pre-formatted, locale-aware check-out date. */
  checkOutDate: string;
}

const codeBlock = (code: string): string => `
  <p style="text-align:center;margin:24px 0;">
    <span style="display:inline-block;padding:12px 28px;border:1px solid #C8A24A;border-radius:8px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:28px;letter-spacing:8px;color:#0E2A47;direction:ltr;unicode-bidi:isolate;">${esc(code)}</span>
  </p>`;

export const stayCodeTemplate: NotificationTemplate<StayCodeVars> = {
  requiredVars: [
    'hotelName',
    'guestName',
    'roomNumber',
    'code',
    'guestAppUrl',
    'checkOutDate',
  ],
  ar: {
    subject: (v) => `رمز الإقامة الخاص بك في ${v.hotelName}`,
    content: (v) => `
      <p>أهلاً ${esc(v.guestName)}،</p>
      <p>يسعدنا إقامتك في ${esc(v.hotelName)} — غرفة <bdi dir="ltr">${esc(v.roomNumber)}</bdi>. هذا هو رمز الإقامة الخاص بك لتطبيق خدمات الفندق:</p>
      ${codeBlock(v.code)}
      <p>افتح تطبيق الضيوف، أدخل رقم غرفتك والرمز، وستصلك كل خدمات الفندق من هاتفك:</p>
      ${ctaButton(safeUrl(v.guestAppUrl), 'فتح تطبيق الضيوف')}
      <p>الرمز صالح حتى نهاية إقامتك في ${esc(v.checkOutDate)}. إذا نسيت الرمز، يمكن لموظف الاستقبال إصدار رمز جديد في أي وقت.</p>`,
  },
  en: {
    subject: (v) => `Your stay code for ${v.hotelName}`,
    content: (v) => `
      <p>Hello ${esc(v.guestName)},</p>
      <p>Welcome to ${esc(v.hotelName)} — room <bdi dir="ltr">${esc(v.roomNumber)}</bdi>. Here is your stay code for the hotel's guest app:</p>
      ${codeBlock(v.code)}
      <p>Open the guest app, enter your room number and this code, and every hotel service is at your fingertips:</p>
      ${ctaButton(safeUrl(v.guestAppUrl), 'Open the guest app')}
      <p>The code stays valid until the end of your stay on ${esc(v.checkOutDate)}. If you forget it, the front desk can issue a new one anytime.</p>`,
  },
};
