import express from 'express';
import { query } from '../db/pool.js';
import { validatePayload, authenticate, requireRole } from '../middleware/security.js';
import { STAFF_ROLES, ATTENDANCE_LOGGING_ROLES as LOGGING_ROLES } from '../middleware/roles.js';
import { siteScope, requireSiteInScope } from '../middleware/scope.js';
import { makeRecordId } from '../utils/ids.js';

const router = express.Router();

// GET /api/absence/logs
router.get('/logs', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    // Only logs for sites inside the caller's scope (SRS FR-6).
    const scope = siteScope(req.user);
    const result = await query(
      `SELECT log_id AS "logId", epf, officer_name AS "officerName", 
              site_id AS "siteId", site_name AS "siteName", 
              date, shift, reason, replacement_deployed AS "replacementDeployed", 
              replacement_epf AS "replacementEpf", notes, submitted_by AS "submittedBy", 
              timestamp, status
       FROM absence_logs
       WHERE site_id IN (${scope.sql})
       ORDER BY timestamp DESC`,
      scope.params
    );
    return res.json({ absenceLogs: result.rows });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve absence audit log' });
  }
});

// POST /api/absence/log
router.post('/log', authenticate, requireRole(...LOGGING_ROLES), validatePayload(['epf', 'officerName', 'siteId', 'siteName', 'date', 'shift', 'reason']), requireSiteInScope, async (req, res) => {
  try {
    const {
      epf,
      officerName,
      siteId,
      siteName,
      date,
      shift,
      reason,
      replacementDeployed,
      replacementEpf,
      notes
    } = req.body;
    // Submitter is the authenticated caller, never a client-supplied value.
    const submittedBy = `${req.user.epf} (${req.user.name})`;

    // UC-2 alternate flow: if an entry already exists for this officer/date/shift,
    // show it instead of a bare "duplicate" error.
    const existing = await query(
      `SELECT log_id AS "logId", epf, officer_name AS "officerName",
              site_id AS "siteId", site_name AS "siteName",
              date, shift, reason, replacement_deployed AS "replacementDeployed",
              replacement_epf AS "replacementEpf", notes, submitted_by AS "submittedBy",
              timestamp, status
       FROM absence_logs
       WHERE epf = $1 AND date = $2 AND shift = $3`,
      [epf, date, shift]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'This officer already has an absence logged for this date and shift',
        existingRecord: existing.rows[0]
      });
    }

    const logId = makeRecordId('ABS-LOG');

    // Parameterized SQL Insert ($1 to $13)
    await query(
      `INSERT INTO absence_logs (
         log_id, epf, officer_name, site_id, site_name, date, shift, 
         reason, replacement_deployed, replacement_epf, notes, submitted_by, timestamp, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, $13)`,
      [
        logId,
        epf,
        officerName,
        siteId,
        siteName,
        date,
        shift,
        reason,
        Boolean(replacementDeployed),
        replacementEpf || 'N/A',
        notes || '',
        submittedBy,
        'Logged & Verified'
      ]
    );

    // If replacement was not deployed, update site shortfall status
    if (!replacementDeployed) {
      await query(
        `UPDATE sites 
         SET current_on_duty = GREATEST(0, current_on_duty - 1), 
             status = 'Alert'
         WHERE site_id = $1`,
        [siteId]
      );
    }

    return res.status(201).json({
      message: 'Guard absence record logged successfully',
      logId
    });
  } catch (error) {
    if (error.code === '23505') {
      // Race-condition backstop: two concurrent submits both passed the pre-check above.
      // Fetch whichever one won so the client still gets a record to show.
      const race = await query(
        `SELECT log_id AS "logId", epf, officer_name AS "officerName",
                site_id AS "siteId", site_name AS "siteName",
                date, shift, reason, replacement_deployed AS "replacementDeployed",
                replacement_epf AS "replacementEpf", notes, submitted_by AS "submittedBy",
                timestamp, status
         FROM absence_logs
         WHERE epf = $1 AND date = $2 AND shift = $3`,
        [req.body.epf, req.body.date, req.body.shift]
      );
      return res.status(409).json({
        error: 'This officer already has an absence logged for this date and shift',
        existingRecord: race.rows[0] || null
      });
    }
    console.error('Absence log error:', error);
    return res.status(500).json({ error: 'Failed to record guard absence log' });
  }
});

export default router;
