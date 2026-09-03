import { toCsv } from './csv-writer';

describe('toCsv (Story 22.5 AC1/AC2)', () => {
  it('joins plain cells with commas', () => {
    const csv = toCsv(['A', 'B'], [['x', 'y']]);

    expect(csv).toContain('A,B');
    expect(csv).toContain('x,y');
  });

  it('quotes a cell containing a comma', () => {
    const csv = toCsv(['Name'], [['Doe, John']]);

    expect(csv).toContain('"Doe, John"');
  });

  it('quotes a cell containing a double quote AND doubles the inner quote', () => {
    const csv = toCsv(['Name'], [['5" pizza']]);

    expect(csv).toContain('"5"" pizza"');
  });

  it('quotes a cell containing a newline', () => {
    const csv = toCsv(['Note'], [['line1\nline2']]);

    expect(csv).toContain('"line1\nline2"');
  });

  it('starts with the UTF-8 BOM character', () => {
    const csv = toCsv(['A'], [['x']]);

    expect(csv.charAt(0)).toBe('﻿');
  });

  it('does not quote numeric cells (unformatted numbers, e.g. 1234.5 stays 1234.5)', () => {
    const csv = toCsv(['Amount'], [[1234.5]]);

    expect(csv).toContain('1234.5');
    expect(csv).not.toContain('"1234.5"');
    expect(csv).not.toContain('1,234.50');
  });

  it('joins rows with CRLF (RFC-4180 line ending)', () => {
    const csv = toCsv(['A'], [['1'], ['2']]);
    const withoutBom = csv.replace('﻿', '');

    expect(withoutBom).toBe('A\r\n1\r\n2');
  });
});
