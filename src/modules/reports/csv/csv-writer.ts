/**
 * RFC-4180 CSV serialization with a UTF-8 BOM (Excel + Arabic text need it
 * to render correctly, not as garbled encoding). A cell is quoted only when
 * it contains a comma, a double quote, or a newline; an embedded double
 * quote is escaped by doubling it, matching RFC-4180 exactly.
 */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escapeCell = (value: string | number): string => {
    const s = String(value);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','));
  return '﻿' + lines.join('\r\n');
}
