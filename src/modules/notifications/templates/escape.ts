/**
 * Story 6.3 — templates are hand-built HTML, so every interpolated value must
 * be escaped. Hotel/owner names originate from onboarding input and setup URLs
 * embed a user-chosen slug; unescaped they allow HTML/attribute injection that
 * reaches real email clients (and the admin preview).
 */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * URLs live in an `href` attribute. Reject anything but http(s) (blocks
 * `javascript:`/`data:` payloads) and attribute-escape what remains.
 */
export function safeUrl(url: unknown): string {
  const raw = String(url);
  return /^https?:\/\//i.test(raw) ? esc(raw) : '#';
}
