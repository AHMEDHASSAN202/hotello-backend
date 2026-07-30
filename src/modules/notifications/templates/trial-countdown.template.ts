import { esc } from './escape';
import { NotificationTemplate } from './template.types';

/** One template, parameterized by days remaining (Story 6.3 AC4). */
export interface TrialCountdownVars {
  hotelName: string;
  ownerName: string;
  daysRemaining: number;
  /** Pre-formatted trial end date. */
  trialEndsAt: string;
}

const arDays = (n: number) =>
  n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : `${n} أيام`;

export const trialCountdownTemplate: NotificationTemplate<TrialCountdownVars> =
  {
    requiredVars: ['hotelName', 'ownerName', 'daysRemaining', 'trialEndsAt'],
    ar: {
      subject: (v) =>
        `تنبيه: تبقى ${arDays(v.daysRemaining)} على انتهاء الفترة التجريبية لـ ${v.hotelName}`,
      content: (v) => `
        <p>مرحباً ${esc(v.ownerName)}،</p>
        <p>تنتهي الفترة التجريبية لفندق ${esc(v.hotelName)} على منصة GXP خلال <strong>${arDays(v.daysRemaining)}</strong> (بتاريخ ${esc(v.trialEndsAt)}).</p>
        <p>للاستمرار في استخدام المنصة دون انقطاع، يرجى التواصل مع فريق GXP لاختيار الباقة المناسبة وإتمام الاشتراك.</p>
        <p>بعد انتهاء الفترة التجريبية سيتحول الحساب إلى وضع القراءة فقط.</p>`,
    },
    en: {
      subject: (v) =>
        `Reminder: ${v.daysRemaining} day${v.daysRemaining === 1 ? '' : 's'} left in the ${v.hotelName} trial`,
      content: (v) => `
        <p>Hello ${esc(v.ownerName)},</p>
        <p>The GXP trial for ${esc(v.hotelName)} ends in <strong>${v.daysRemaining} day${v.daysRemaining === 1 ? '' : 's'}</strong> (on ${esc(v.trialEndsAt)}).</p>
        <p>To keep using the platform without interruption, please contact the GXP team to choose a plan and complete your subscription.</p>
        <p>When the trial ends, the account switches to read-only mode.</p>`,
    },
  };
