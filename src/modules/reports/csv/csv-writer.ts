/** A cell beginning with one of these is interpreted as a formula by Excel/LibreOffice/Sheets (CWE-1236). */
const FORMULA_LEADING_CHAR = /^[=+\-@]/;

/**
 * RFC-4180 CSV serialization with a UTF-8 BOM (Excel + Arabic text need it
 * to render correctly, not as garbled encoding). A cell is quoted when it
 * contains a comma, a double quote, a carriage return, or a line feed —
 * each independently, per RFC-4180 (a lone `\r` with no following `\n` must
 * still trigger quoting; different consumers disagree on how to treat a
 * bare `\r`, so leaving it unquoted risks silently corrupting row
 * structure); an embedded double quote is escaped by doubling it.
 *
 * CSV formula injection guard (CWE-1236): our feeds carry guest-influenceable
 * text (names, notes, cancellation reasons). A string cell starting with
 * `=`, `+`, `-`, or `@` is prefixed with a single quote — the standard
 * mitigation, which Excel/Sheets render as "force text" (stripped from
 * display) instead of evaluating as a formula. Only *string*-typed cells are
 * guarded: a genuine JS `number` (e.g. a negative revenue figure) can never
 * carry injected formula syntax, and prefixing it would silently turn a
 * legitimate negative number into text. The prefixed value still passes
 * through the normal RFC-4180 quote-if-needed check below, since a
 * formula-looking value can also independently contain a comma/quote/newline.
 */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escapeCell = (value: string | number): string => {
    let s = String(value);
    if (typeof value === 'string' && FORMULA_LEADING_CHAR.test(s)) {
      s = `'${s}`;
    }
    if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','));
  return '﻿' + lines.join('\r\n');
}
