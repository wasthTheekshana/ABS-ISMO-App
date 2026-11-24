import express from 'express';
import { query } from '../db/pool.js';
import { validatePayload, authenticate, requireRole } from '../middleware/security.js';
import { STAFF_ROLES, ATTENDANCE_LOGGING_ROLES as LOGGING_ROLES } from '../middleware/roles.js';
import { siteScope, requireSiteInScope, isSiteInScope } from '../middleware/scope.js';
import { makeRecordId } from '../utils/ids.js';

const router = express.Router();

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const toMinutes = (t) => {
  const m = TIME_RE.exec(String(t));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

/**
 * Minutes late. Uses the client's delayMinutes when it is a valid non-negative integer,
 * otherwise derives it from scheduled vs actual time (wrapping past midnight for night
 * shifts). Returns null when the input is unusable.
 */
export const resolveDelayMinutes = (scheduledTime, actualTime, delayMinutes) => {
  const scheduled = toMinutes(scheduledTime);
  const actual = toMinutes(actualTime);
  if (scheduled === null || actual === null) return null;

  if (delayMinutes !== undefined && delayMinutes !== null && delayMinutes !== '') {
    const n = Number(delayMinutes);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  const diff = (actual - scheduled + 1440) % 1440;
  // More than 12h "late" really means actual is BEFORE scheduled (arrived early) — not a late report.
  return diff > 720 ? null : diff;
};

// GET /api/late/logs
router.get('/logs', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    // Only logs for sites inside the caller's scope (SRS FR-6).
    const scope = siteScope(req.user);
    const result = await query(
      `SELECT log_id AS "logId", epf, officer_name AS "officerName", 
              site_id AS "siteId", site_name AS "siteName", 
              date, shift, scheduled_time AS "scheduledTime", 
              actual_time AS "actualTime", delay_minutes AS "delayMinutes", 
              reason, remarks, submitted_by AS "submittedBy", timestamp, status
       FROM late_logs
       WHERE site_id IN (${scope.sql})
       ORDER BY timestamp DESC`,
      scope.params
    );
    return res.json({ lateLogs: result.rows });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve late reporting audit log' });
  }
});

// POST /api/late/log
router.post('/log', authenticate, requireRole(...LOGGING_ROLES), validatePayload(['epf', 'officerName', 'siteId', 'siteName', 'date', 'shift', 'scheduledTime', 'actualTime', 'reason']), requireSiteInScope, async (req, res) => {
  try {
    const {
      epf,
      officerName,
      siteId,
      siteName,
      date,
      shift,
      scheduledTime,
      actualTime,
      delayMinutes,
      reason,
      remarks
    } = req.body;
    // Submitter is the authenticated caller, never a client-supplied value.
    const submittedBy = `${req.user.epf} (${req.user.name})`;

    // Delay is derived from the two times unless the client supplied a valid value —
    // never silently stored as 0, which would under-report lateness in the KPIs.
    const delay = resolveDelayMinutes(scheduledTime, actualTime, delayMinutes);
    if (delay === null) {
      return res.status(400).json({
        error: 'scheduledTime/actualTime must be valid HH:MM times and delayMinutes a non-negative whole number'
      });
    }

    // UC-2 alternate flow: if an entry already exists for this officer/date/shift,
    // show it instead of a bare "duplicate" error.
    const existing = await query(
      `SELECT log_id AS "logId", epf, officer_name AS "officerName",
              site_id AS "siteId", site_name AS "siteName",
              date, shift, scheduled_time AS "scheduledTime",
              actual_time AS "actualTime", delay_minutes AS "delayMinutes",
              reason, remarks, submitted_by AS "submittedBy", timestamp, status
       FROM late_logs
       WHERE epf = $1 AND date = $2 AND shift = $3`,
      [epf, date, shift]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'This officer already has a late-reporting entry logged for this date and shift',
        existingRecord: (await isSiteInScope(req.user, existing.rows[0].siteId)) ? existing.rows[0] : null
      });
    }

    const logId = makeRecordId('LATE-LOG');

    // Parameterized SQL Insert ($1 to $14)
    await query(
      `INSERT INTO late_logs (
         log_id, epf, officer_name, site_id, site_name, date, shift, 
         scheduled_time, actual_time, delay_minutes, reason, remarks, submitted_by, timestamp, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, $14)`,
      [
        logId,
        epf,
        officerName,
        siteId,
        siteName,
        date,
        shift,
        scheduledTime,
        actualTime,
        delay,
        reason,
        remarks || '',
        submittedBy,
        'Logged & Actioned'
      ]
    );

    return res.status(201).json({
      message: 'Late reporting record logged successfully',
      logId
    });
  } catch (error) {
    if (error.code === '23505') {
      const race = await query(
        `SELECT log_id AS "logId", epf, officer_name AS "officerName",
                site_id AS "siteId", site_name AS "siteName",
                date, shift, scheduled_time AS "scheduledTime",
                actual_time AS "actualTime", delay_minutes AS "delayMinutes",
                reason, remarks, submitted_by AS "submittedBy", timestamp, status
         FROM late_logs
         WHERE epf = $1 AND date = $2 AND shift = $3`,
        [req.body.epf, req.body.date, req.body.shift]
      );
      return res.status(409).json({
        error: 'This officer already has a late-reporting entry logged for this date and shift',
        existingRecord: race.rows[0] && (await isSiteInScope(req.user, race.rows[0].siteId)) ? race.rows[0] : null
      });
    }
    console.error('Late log error:', error);
    return res.status(500).json({ error: 'Failed to record late reporting log' });
  }
});

export default router;
