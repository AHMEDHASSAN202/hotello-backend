import { SuspensionReason } from '../../hotels/hotels.constants';
import { esc } from './escape';
import { NotificationTemplate } from './template.types';

/**
 * Story 6.6 AC1 — only the reason *category* is communicated; the internal
 * free-text note never leaves the platform.
 */
export interface HotelSuspendedVars {
  hotelName: string;
  ownerName: string;
  reason: SuspensionReason;
}

const REASON_LABELS: Record<SuspensionReason, { ar: string; en: string }> = {
  non_payment: { ar: 'عدم سداد المستحقات', en: 'non-payment' },
  policy_violation: {
    ar: 'مخالفة سياسات المنصة',
    en: 'a policy violation',
  },
  hotel_request: { ar: 'طلب من الفندق', en: 'a request from the hotel' },
  other: { ar: 'أسباب إدارية', en: 'administrative reasons' },
};

export const hotelSuspendedTemplate: NotificationTemplate<HotelSuspendedVars> =
  {
    requiredVars: ['hotelName', 'ownerName', 'reason'],
    ar: {
      subject: (v) => `تم تعليق حساب ${v.hotelName} على منصة GXP`,
      content: (v) => `
        <p>مرحباً ${esc(v.ownerName)}،</p>
        <p>نحيطكم علماً بأنه تم تعليق حساب ${esc(v.hotelName)} على منصة GXP بسبب: <strong>${REASON_LABELS[v.reason].ar}</strong>.</p>
        <p>خلال فترة التعليق لن يتمكن فريق الفندق أو النزلاء من استخدام المنصة.</p>
        <p>لمناقشة إعادة التفعيل أو الاستفسار، يرجى التواصل مع فريق GXP.</p>`,
    },
    en: {
      subject: (v) => `${v.hotelName} has been suspended on GXP`,
      content: (v) => `
        <p>Hello ${esc(v.ownerName)},</p>
        <p>This is to inform you that the ${esc(v.hotelName)} account on the GXP Platform has been suspended due to: <strong>${REASON_LABELS[v.reason].en}</strong>.</p>
        <p>While suspended, hotel staff and guests cannot use the platform.</p>
        <p>To discuss reactivation or ask questions, please contact the GXP team.</p>`,
    },
  };
