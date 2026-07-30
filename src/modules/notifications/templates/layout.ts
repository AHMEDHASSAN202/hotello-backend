import { NotificationLanguage } from '../notifications.constants';
import { esc, safeUrl } from './escape';

export const BRAND_NAVY = '#0E2A47';
export const BRAND_GOLD = '#C8A24A';

/**
 * Story 6.3 AC2/AC3 — one shared shell for every notification type:
 * table-based layout, inline CSS only (no external stylesheets), navy/gold
 * brand identity, `dir="rtl"` + right alignment for Arabic.
 */
export function baseLayout(opts: {
  language: NotificationLanguage;
  title: string;
  contentHtml: string;
}): string {
  const rtl = opts.language === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const footer = rtl
    ? 'هذه رسالة آلية من منصة GXP — يرجى عدم الرد عليها.'
    : 'This is an automated message from the GXP Platform — please do not reply.';

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${esc(opts.language)}">
<head><meta charset="utf-8"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background-color:#F5F3EE;" dir="${dir}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F3EE;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border:1px solid #E4E0D6;">
          <tr>
            <td style="background-color:${BRAND_NAVY};padding:20px 32px;text-align:${align};">
              <span style="font-family:Georgia,serif;font-size:20px;color:#FFFFFF;font-weight:bold;">GXP</span>
              <span style="font-family:Georgia,serif;font-size:20px;color:${BRAND_GOLD};font-weight:bold;">&nbsp;Platform</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${BRAND_NAVY};text-align:${align};" dir="${dir}">
              ${opts.contentHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:2px solid ${BRAND_GOLD};font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6B7280;text-align:${align};" dir="${dir}">
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Shared gold call-to-action button, email-client-safe. */
export function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
    <tr>
      <td style="background-color:${BRAND_GOLD};border-radius:4px;">
        <a href="${safeUrl(url)}" style="display:inline-block;padding:12px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${BRAND_NAVY};text-decoration:none;">${esc(label)}</a>
      </td>
    </tr>
  </table>`;
}
