import { esc } from './escape';
import { NotificationTemplate } from './template.types';

export interface TrialExpiredVars {
  hotelName: string;
  ownerName: string;
}

export const trialExpiredTemplate: NotificationTemplate<TrialExpiredVars> = {
  requiredVars: ['hotelName', 'ownerName'],
  ar: {
    subject: (v) => `انتهت الفترة التجريبية لـ ${v.hotelName}`,
    content: (v) => `
      <p>مرحباً ${esc(v.ownerName)}،</p>
      <p>انتهت الفترة التجريبية لفندق ${esc(v.hotelName)} على منصة GXP، وتم تحويل الحساب إلى <strong>وضع القراءة فقط</strong> — تبقى بياناتك محفوظة بالكامل.</p>
      <p>لإعادة تفعيل جميع المزايا، يرجى التواصل مع فريق GXP لاختيار الباقة المناسبة وإتمام الاشتراك.</p>`,
  },
  en: {
    subject: (v) => `The ${v.hotelName} trial has ended`,
    content: (v) => `
      <p>Hello ${esc(v.ownerName)},</p>
      <p>The GXP trial for ${esc(v.hotelName)} has ended and the account is now in <strong>read-only mode</strong> — all of your data is safe.</p>
      <p>To restore full access, please contact the GXP team to choose a plan and complete your subscription.</p>`,
  },
};
