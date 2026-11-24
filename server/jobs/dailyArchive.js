import { query } from '../db/pool.js';
import { REPORT_TYPES, SYSTEM_USER, buildReport, localDate } from '../services/reports.js';

/**
 * Automatic daily report generation (SRS FR-18): once a day the organisation-wide copy of every
 * report for the previous day is stored in daily_reports, so a manager can read yesterday's
 * report exactly as it was even after later corrections to the live data.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Date string (YYYY-MM-DD, operating time zone) of the day before `now`. */
export const yesterday = (now = new Date()) => localDate(new Date(now.getTime() - 24 * HOUR_MS));

/** Generates and stores all report types for a date, replacing any earlier copy. Returns how many. */
export const archiveDay = async (date) => {
  const types = Object.keys(REPORT_TYPES);
  for (const type of types) {
    const report = await buildReport(type, date, SYSTEM_USER);
    await query(
      `INSERT INTO daily_reports (report_date, report_type, payload, generated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (report_date, report_type) DO UPDATE SET payload = EXCLUDED.payload, generated_at = CURRENT_TIMESTAMP`,
      [date, type, JSON.stringify(report)]
    );
  }
  return types.length;
};

/** Archives a date only if it is not already complete. Returns true when it generated anything. */
export const archiveIfMissing = async (date) => {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM daily_reports WHERE report_date = $1', [date]);
  if (rows[0].n >= Object.keys(REPORT_TYPES).length) return false;
  await archiveDay(date);
  return true;
};

/**
 * Starts the job: archive yesterday now (catches up after the server was off overnight) and
 * re-check every hour. The timer never keeps the process alive on its own.
 */
export const startDailyArchive = () => {
  const tick = () =>
    archiveIfMissing(yesterday())
      .then((ran) => { if (ran) console.log(`[daily-reports] archived ${yesterday()}`); })
      .catch((error) => console.error('[daily-reports] archive failed:', error.message));
  tick();
  const timer = setInterval(tick, HOUR_MS);
  timer.unref();
  return timer;
};
