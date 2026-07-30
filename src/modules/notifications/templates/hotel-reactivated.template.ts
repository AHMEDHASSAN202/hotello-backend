import { esc } from './escape';
import { NotificationTemplate } from './template.types';

export interface HotelReactivatedVars {
  hotelName: string;
  ownerName: string;
}

export const hotelReactivatedTemplate: NotificationTemplate<HotelReactivatedVars> =
  {
    requiredVars: ['hotelName', 'ownerName'],
    ar: {
      subject: (v) => `تمت إعادة تفعيل حساب ${v.hotelName} على منصة GXP`,
      content: (v) => `
        <p>مرحباً ${esc(v.ownerName)}،</p>
        <p>يسعدنا إبلاغكم بأنه تمت إعادة تفعيل حساب ${esc(v.hotelName)} على منصة GXP، ويمكن لفريق الفندق والنزلاء استخدام المنصة بشكل كامل من جديد.</p>
        <p>شكراً لتعاونكم.</p>`,
    },
    en: {
      subject: (v) => `${v.hotelName} has been reactivated on GXP`,
      content: (v) => `
        <p>Hello ${esc(v.ownerName)},</p>
        <p>Good news — the ${esc(v.hotelName)} account on the GXP Platform has been reactivated. Hotel staff and guests have full access again.</p>
        <p>Thank you for your cooperation.</p>`,
    },
  };
