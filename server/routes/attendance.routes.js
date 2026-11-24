import express from 'express';
import { query } from '../db/pool.js';
import { validatePayload, authenticate } from '../middleware/security.js';
import { requireSiteInScope } from '../middleware/scope.js';

const router = express.Router();

// GET /api/attendance/mine — the caller's open shift (if any) plus recent history.
// Drives FR-1's "currently on duty" figure: a site only counts an officer as
// on-duty while they have a row here with no check_out_time yet.
router.get('/mine', authenticate, async (req, res) => {
  try {
    const activeRes = await query(
      `SELECT id, site_id AS "siteId", shift, check_in_time AS "checkInTime"
       FROM duty_attendance
       WHERE epf = $1 AND check_out_time IS NULL
       ORDER BY check_in_time DESC
       LIMIT 1`,
      [req.user.epf]
    );

    const historyRes = await query(
      `SELECT da.id, da.site_id AS "siteId", s.name AS "siteName", da.shift,
              da.check_in_time AS "checkInTime", da.check_out_time AS "checkOutTime",
              da.status, da.date
       FROM duty_attendance da
       LEFT JOIN sites s ON s.site_id = da.site_id
       WHERE da.epf = $1
       ORDER BY da.check_in_time DESC
       LIMIT 10`,
      [req.user.epf]
    );

    return res.json({
      activeShift: activeRes.rows[0] || null,
      history: historyRes.rows
    });
  } catch (error) {
    console.error('Fetch attendance error:', error);
    return res.status(500).json({ error: 'Failed to retrieve attendance record' });
  }
});

// POST /api/attendance/check-in
router.post('/check-in', authenticate, validatePayload(['epf', 'siteId', 'shift']), requireSiteInScope, async (req, res) => {
  try {
    const { epf, siteId, shift, gpsLat, gpsLng } = req.body;

    // An officer can only check THEMSELVES in; never trust a client-supplied identity.
    if (epf !== req.user.epf) {
      return res.status(403).json({ error: 'You can only record your own check-in' });
    }

    const openShift = await query(
      `SELECT id FROM duty_attendance WHERE epf = $1 AND check_out_time IS NULL LIMIT 1`,
      [epf]
    );
    if (openShift.rows.length > 0) {
      return res.status(409).json({ error: 'You already have an open shift — check out first' });
    }

    const result = await query(
      `INSERT INTO duty_attendance (epf, site_id, shift, check_in_time, gps_lat, gps_lng, status, date)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, 'Checked In', CURRENT_DATE)
       RETURNING id, check_in_time`,
      [epf, siteId, shift, gpsLat || null, gpsLng || null]
    );

    return res.status(201).json({
      message: 'Shift check-in recorded successfully',
      recordId: result.rows[0].id,
      checkInTime: result.rows[0].check_in_time
    });
  } catch (error) {
    if (error.code === '23505') {
      // Lost a race with a simultaneous check-in by the same officer.
      return res.status(409).json({ error: 'You already have an open shift — check out first' });
    }
    console.error('Check-in error:', error);
    return res.status(500).json({ error: 'Failed to record shift check-in' });
  }
});

// POST /api/attendance/check-out
router.post('/check-out', authenticate, validatePayload(['recordId']), async (req, res) => {
  try {
    const { recordId } = req.body;

    const result = await query(
      `UPDATE duty_attendance
       SET check_out_time = CURRENT_TIMESTAMP, status = 'Completed Shift'
       WHERE id = $1 AND epf = $2 AND check_out_time IS NULL
       RETURNING id`,
      [recordId, req.user.epf]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No matching open shift found for this record' });
    }

    return res.json({ message: 'Shift check-out recorded successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to record shift check-out' });
  }
});

export default router;
