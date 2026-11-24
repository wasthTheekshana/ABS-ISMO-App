import express from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/security.js';
import { REPORT_ROLES, NVO_LOCATION_ROLES } from '../middleware/roles.js';
import { REPORT_TYPES, buildReport, isValidDate, localDate } from '../services/reports.js';

/**
 * Daily reports (SRS FR-18).
 *
 *   GET /types                       the eight report types
 *   GET /daily?type=&date=           generated live for the caller's site scope (date defaults to today)
 *   GET /archive?type=&date=         the stored organisation-wide copy made by the nightly job (MD, GM)
 */
const router = express.Router();

const checkType = (type) => (Object.hasOwn(REPORT_TYPES, type) ? null : `type must be one of: ${Object.keys(REPORT_TYPES).join(', ')}`);

// GET /api/reports/types
router.get('/types', authenticate, requireRole(...REPORT_ROLES), (req, res) => {
  res.json({ types: Object.entries(REPORT_TYPES).map(([type, title]) => ({ type, title })) });
});

// GET /api/reports/daily
router.get('/daily', authenticate, requireRole(...REPORT_ROLES), async (req, res) => {
  const type = String(req.query.type ?? '');
  const date = req.query.date ? String(req.query.date) : localDate();
  const typeError = checkType(type);
  if (typeError) return res.status(400).json({ error: typeError });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be a valid date (YYYY-MM-DD)' });

  try {
    return res.json(await buildReport(type, date, req.user));
  } catch (error) {
    console.error('Daily report error:', error);
    return res.status(500).json({ error: 'Failed to generate the report' });
  }
});

// GET /api/reports/archive
router.get('/archive', authenticate, requireRole(...NVO_LOCATION_ROLES), async (req, res) => {
  const type = String(req.query.type ?? '');
  const date = String(req.query.date ?? '');
  const typeError = checkType(type);
  if (typeError) return res.status(400).json({ error: typeError });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be a valid date (YYYY-MM-DD)' });

  try {
    const stored = await query('SELECT payload FROM daily_reports WHERE report_date = $1 AND report_type = $2', [date, type]);
    if (stored.rows.length === 0) return res.status(404).json({ error: 'No archived copy exists for that date yet' });
    return res.json(stored.rows[0].payload);
  } catch (error) {
    console.error('Report archive error:', error);
    return res.status(500).json({ error: 'Failed to load the archived report' });
  }
});

export default router;
