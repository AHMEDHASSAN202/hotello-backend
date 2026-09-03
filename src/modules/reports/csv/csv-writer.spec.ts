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

describe('toCsv — CSV formula injection guard (CWE-1236, security fix round)', () => {
  it('1. a cell starting with "=" is prefixed with a single quote, still readable as \'=1+1', () => {
    const csv = toCsv(['Formula'], [['=1+1']]);

    expect(csv).toContain("'=1+1");
  });

  it('2. cells starting with "+", "-", "@" are each prefixed with a single quote', () => {
    expect(toCsv(['A'], [['+1']])).toContain("'+1");
    expect(toCsv(['A'], [['-1']])).toContain("'-1");
    expect(toCsv(['A'], [['@SUM(1)']])).toContain("'@SUM(1)");
  });

  it('3. a formula-looking cell that ALSO contains a comma gets BOTH the quote-prefix AND full RFC-4180 quoting', () => {
    const csv = toCsv(['Formula'], [['=SUM(A1,A2)']]);

    expect(csv).toContain('"\'=SUM(A1,A2)"');
  });

  it('4. a cell with "=" in the MIDDLE (not leading) is NOT prefixed', () => {
    const csv = toCsv(['Room'], [['Room A=101']]);

    expect(csv).toContain('Room A=101');
    expect(csv).not.toContain("'Room A=101");
  });

  it('5. a cell containing a lone carriage return (no \\n) is now quoted', () => {
    const csv = toCsv(['Note'], [['a\rb']]);

    expect(csv).toContain('"a\rb"');
  });

  it('6. a genuine numeric cell (not a string) is never prefixed, even when negative', () => {
    const csv = toCsv(['Amount'], [[-50]]);

    expect(csv).toContain('-50');
    expect(csv).not.toContain("'-50");
    expect(csv).not.toContain('"-50"');
  });

  it('re-confirms all previously-passing cases are unaffected by the fix', () => {
    expect(toCsv(['A', 'B'], [['x', 'y']])).toContain('A,B');
    expect(toCsv(['Name'], [['Doe, John']])).toContain('"Doe, John"');
    expect(toCsv(['Name'], [['5" pizza']])).toContain('"5"" pizza"');
    expect(toCsv(['Note'], [['line1\nline2']])).toContain('"line1\nline2"');
    expect(toCsv(['A'], [['x']]).charAt(0)).toBe('﻿');
    const numeric = toCsv(['Amount'], [[1234.5]]);
    expect(numeric).toContain('1234.5');
    expect(numeric).not.toContain('"1234.5"');
  });
});
