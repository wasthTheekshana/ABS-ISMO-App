import express from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/security.js';
import { siteScope } from '../middleware/scope.js';
import { CONTROL_ROOM_BOARD_ROLES } from '../middleware/roles.js';

const router = express.Router();

const BOARD_LIST_LIMIT = 100;

// GET /api/control-room/board
// One call for the Control Room's live picture: what is open, where cover is short, and what
// went wrong today. Read-only; acting on an incident uses the normal /api/incidents endpoints.
router.get('/board', authenticate, requireRole(...CONTROL_ROOM_BOARD_ROLES), async (req, res) => {
  try {
    const scope = siteScope(req.user);
    const params = scope.params;

    const incidents = await query(
      `SELECT incident_id AS "incidentId", category, sub_type AS "subType", severity,
              site_id AS "siteId", site_name AS "siteName", description, status,
              police_notified AS "policeNotified", hospital_notified AS "hospitalNotified",
              fire_notified AS "fireNotified", reported_by AS "reportedBy",
              created_at AS "createdAt",
              FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at)) / 60)::int AS "ageMinutes"
       FROM incidents
       WHERE status <> 'Closed' AND site_id IN (${scope.sql})
       ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
                (status = 'Escalated') DESC, created_at ASC
       LIMIT ${BOARD_LIST_LIMIT}`,
      params
    );

    // Same live "on duty" rule as /api/sites: today's open check-ins, else the seeded baseline.
    const sites = await query(
      `SELECT s.site_id AS "siteId", s.name, s.sector, s.region, s.status,
              s.required_officers AS "requiredOfficers",
              COALESCE(live.on_duty_count, s.current_on_duty)::int AS "currentOnDuty",
              GREATEST(0, s.required_officers - COALESCE(live.on_duty_count, s.current_on_duty))::int AS shortfall,
              s.assigned_vo AS "assignedVO", s.assigned_nvo AS "assignedNVO"
       FROM sites s
       LEFT JOIN (
         SELECT site_id, COUNT(*) FILTER (WHERE check_out_time IS NULL) AS on_duty_count
         FROM duty_attendance WHERE date = CURRENT_DATE GROUP BY site_id
       ) live ON live.site_id = s.site_id
       WHERE s.site_id IN (${scope.sql})
         AND (s.status = 'Alert' OR s.required_officers > COALESCE(live.on_duty_count, s.current_on_duty))
       ORDER BY GREATEST(0, s.required_officers - COALESCE(live.on_duty_count, s.current_on_duty)) DESC, s.name ASC`,
      params
    );

    const absences = await query(
      `SELECT log_id AS "logId", epf, officer_name AS "officerName", site_id AS "siteId",
              site_name AS "siteName", shift, reason, replacement_deployed AS "replacementDeployed",
              timestamp
       FROM absence_logs WHERE date = CURRENT_DATE AND site_id IN (${scope.sql})
       ORDER BY timestamp DESC LIMIT ${BOARD_LIST_LIMIT}`,
      params
    );

    const lates = await query(
      `SELECT log_id AS "logId", epf, officer_name AS "officerName", site_id AS "siteId",
              site_name AS "siteName", shift, delay_minutes AS "delayMinutes", reason, timestamp
       FROM late_logs WHERE date = CURRENT_DATE AND site_id IN (${scope.sql})
       ORDER BY timestamp DESC LIMIT ${BOARD_LIST_LIMIT}`,
      params
    );

    const onDuty = await query(
      `SELECT COUNT(*)::int AS n FROM duty_attendance
       WHERE date = CURRENT_DATE AND check_out_time IS NULL AND site_id IN (${scope.sql})`,
      params
    );

    const open = incidents.rows;
    return res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        openIncidents: open.length,
        criticalOpen: open.filter((i) => i.severity === 'Critical').length,
        escalated: open.filter((i) => i.status === 'Escalated').length,
        oldestOpenMinutes: open.reduce((max, i) => Math.max(max, i.ageMinutes), 0),
        sitesNeedingAttention: sites.rows.length,
        absencesToday: absences.rows.length,
        lateToday: lates.rows.length,
        onDutyNow: onDuty.rows[0].n
      },
      incidents: open,
      sites: sites.rows,
      absencesToday: absences.rows,
      lateToday: lates.rows
    });
  } catch (error) {
    console.error('Control room board error:', error);
    return res.status(500).json({ error: 'Failed to load the operations board' });
  }
});

export default router;
