/**
 * CSV export for the daily reports (SRS FR-18). Pure functions, no DOM, so they can be tested.
 */

/**
 * RFC 4180 quoting. A text value that starts with =, +, - or @ is prefixed with an apostrophe so a
 * spreadsheet shows it as text instead of running it as a formula (CSV injection): report rows
 * include free text typed by clients and guards. Real numbers, including negatives, are left alone.
 */
export const csvCell = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** A whole report ({ columns: [{key,label}], rows: [{...}] }) as CSV text with CRLF line endings. */
export const reportToCsv = (report) => {
  const header = report.columns.map((c) => csvCell(c.label)).join(',');
  const lines = report.rows.map((row) => report.columns.map((c) => csvCell(row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
};
