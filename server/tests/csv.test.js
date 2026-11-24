import { describe, it, expect } from 'vitest';
import { csvCell, reportToCsv } from '../../src/utils/csv.js';

/** CSV export of the daily reports (SRS FR-18): quoting and spreadsheet-formula safety. */

describe('csvCell', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvCell('Cargills Main')).toBe('Cargills Main');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(-3.5)).toBe('-3.5');
  });

  it('writes empty for null and undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and line breaks, doubling inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it.each(['=SUM(A1:A9)', '+94771234567x', '-cmd|calc', '@SUM(1)', '=HYPERLINK("http://evil","click")'])(
    'defuses a value a spreadsheet could run as a formula: %s', (value) => {
      expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
    }
  );

  it('does not touch real negative numbers or numeric strings', () => {
    expect(csvCell('-12')).toBe('-12');
    expect(csvCell('+5')).toBe('+5');
  });

  it('defuses and quotes together', () => {
    expect(csvCell('=1,2')).toBe('"\'=1,2"');
  });
});

describe('reportToCsv', () => {
  const report = {
    columns: [{ key: 'site', label: 'Site' }, { key: 'note', label: 'Note, with comma' }, { key: 'n', label: 'Count' }],
    rows: [
      { site: 'A', note: 'fine', n: 3 },
      { site: 'B', note: '=cmd()', n: null }
    ]
  };

  it('writes a header, then one line per row, in column order, with CRLF endings', () => {
    expect(reportToCsv(report)).toBe(['Site,"Note, with comma",Count', 'A,fine,3', "B,'=cmd(),"].join('\r\n'));
  });

  it('writes only the header for an empty report', () => {
    expect(reportToCsv({ columns: report.columns, rows: [] })).toBe('Site,"Note, with comma",Count');
  });

  it('leaves a blank cell for a missing key', () => {
    expect(reportToCsv({ columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], rows: [{ a: 1 }] })).toBe('A,B\r\n1,');
  });
});
