import express from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/security.js';
import { SITE_READ_ROLES } from '../middleware/roles.js';
import { siteScope } from '../middleware/scope.js';

const router = express.Router();

// GET /api/sites
router.get('/', authenticate, requireRole(...SITE_READ_ROLES), async (req, res) => {
  try {
    // Scope comes ONLY from the verified JWT (req.user) via the shared siteScope helper —
    // never from client-supplied query params (SRS FR-6). Unknown roles fail closed.
    const scope = siteScope(req.user);

    // "Currently on duty" (FR-1) is computed live from today's open check-ins
    // (duty_attendance rows with no check-out yet), not a static counter. Once a site has
    // ANY attendance row today the live figure is authoritative — so it drops to 0 when
    // everyone has checked out. It falls back to the seeded baseline only on a site with
    // no attendance activity at all today, per the Pilot's "manual update" fallback (SRS §2.6).
    let sql = `SELECT s.site_id AS "siteId", s.name, s.sector, s.region,
                      s.required_officers AS "requiredOfficers",
                      COALESCE(live.on_duty_count, s.current_on_duty)::int AS "currentOnDuty",
                      GREATEST(0, s.required_officers - COALESCE(live.on_duty_count, s.current_on_duty))::int AS shortfall,
                      s.assigned_vo AS "assignedVO",
                      s.assigned_nvo AS "assignedNVO", s.status, s.location
               FROM sites s
               LEFT JOIN (
                 SELECT site_id, COUNT(*) FILTER (WHERE check_out_time IS NULL) AS on_duty_count
                 FROM duty_attendance
                 WHERE date = CURRENT_DATE
                 GROUP BY site_id
               ) live ON live.site_id = s.site_id
               WHERE s.site_id IN (${scope.sql})`;
    const params = scope.params;

    sql += ` ORDER BY name ASC`;

    const result = await query(sql, params);
    return res.json({ sites: result.rows });
  } catch (error) {
    console.error('Error fetching sites:', error);
    return res.status(500).json({ error: 'Failed to retrieve site roster' });
  }
});

export default router;
