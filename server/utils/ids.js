import crypto from 'crypto';

/**
 * Human-readable record ID: <prefix>-<YYYYMMDD>-<6 hex chars>, e.g. ABS-LOG-20261108-3FA9C1.
 * 24 bits of CSPRNG entropy per day (vs. the previous 3-digit Math.random suffix, which
 * had ~3% collision odds after only 8 records and surfaced as a 500 on the primary key).
 */
export const makeRecordId = (prefix) => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${dateStr}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};
