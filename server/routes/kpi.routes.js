import express from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/security.js';
import { STAFF_ROLES } from '../middleware/roles.js';
import { siteScope } from '../middleware/scope.js';

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

/** Parses ?from=&to= (YYYY-MM-DD). Returns null when absent, { error } when invalid. */
export const parseRange = (q) => {
  if (!q.from && !q.to) return null;
  const invalid = { error: 'from and to must both be valid dates (YYYY-MM-DD)' };
  if (!DATE_RE.test(String(q.from)) || !DATE_RE.test(String(q.to))) return invalid;
  const from = new Date(`${q.from}T00:00:00Z`);
  const to = new Date(`${q.to}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())
      || from.toISOString().slice(0, 10) !== q.from || to.toISOString().slice(0, 10) !== q.to) {
    return invalid;
  }
  if (to < from) return { error: 'to must not be before from' };
  const days = Math.round((to - from) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` };
  return { from: q.from, to: q.to, days };
};

// GET /api/kpis/executive
router.get('/executive', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    // Scope comes ONLY from the verified JWT (req.user) via the shared siteScope helper,
    // never from client-supplied query params, so a caller cannot widen their own scope
    // (SRS FR-6). Unknown roles fail closed.
    const range = parseRange(req.query);
    if (range && range.error) return res.status(400).json({ error: range.error });

    const scope = siteScope(req.user);
    const params = scope.params;

    // "On duty" is live from today's open check-ins (see sites.routes.js), falling
    // back to the seeded baseline on a site with no attendance activity logged yet today.
    let siteSql = `SELECT SUM(required_officers) AS total_required,
                          SUM(COALESCE(live.on_duty_count, sites.current_on_duty)) AS total_onduty,
                          SUM(GREATEST(0, required_officers - COALESCE(live.on_duty_count, sites.current_on_duty))) AS total_shortfall
                   FROM sites
                   LEFT JOIN (
                     SELECT site_id, COUNT(*) FILTER (WHERE check_out_time IS NULL) AS on_duty_count
                     FROM duty_attendance
                     WHERE date = CURRENT_DATE
                     GROUP BY site_id
                   ) live ON live.site_id = sites.site_id
                   WHERE sites.site_id IN (${scope.sql})`;

    const siteRes = await query(siteSql, params);
    const row = siteRes.rows[0] || {};

    const totalRequired = parseInt(row.total_required || '0', 10);
    const totalOnDuty = parseInt(row.total_onduty || '0', 10);
    const totalShortfall = parseInt(row.total_shortfall || '0', 10);

    // Site scope reused as a subquery so the trend series is scoped the same way (SRS FR-6).
    const scopeSubquery = scope.sql;

    // Count Absence and Late logs, scoped to the caller's visible sites
    const absenceCountRes = await query(
      `SELECT COUNT(*) FROM absence_logs WHERE site_id IN (${scopeSubquery})`,
      params
    );
    const lateCountRes = await query(
      `SELECT COUNT(*) FROM late_logs WHERE site_id IN (${scopeSubquery})`,
      params
    );

    const totalAbsenceCount = parseInt(absenceCountRes.rows[0].count || '0', 10);
    const totalLateCount = parseInt(lateCountRes.rows[0].count || '0', 10);

    // 6-month absenteeism trend (SRS FR-3) — same "guard-days" approximation as the
    // headline figure (absence count / (required officers * 30 days)) applied per month.
    const trendRes = await query(
      `SELECT TO_CHAR(month_start, 'Mon YYYY') AS month,
              month_start,
              COUNT(al.log_id) AS absence_count
       FROM generate_series(
              date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
              date_trunc('month', CURRENT_DATE),
              INTERVAL '1 month'
            ) AS month_start
       LEFT JOIN absence_logs al
         ON date_trunc('month', al.date) = month_start
         AND al.site_id IN (${scopeSubquery})
       GROUP BY month_start
       ORDER BY month_start ASC`,
      params
    );

    const monthlyTrend = trendRes.rows.map(r => ({
      month: r.month,
      absenteeismPercentage: totalRequired > 0
        ? Number(((parseInt(r.absence_count, 10) / (totalRequired * 30)) * 100).toFixed(2))
        : 0
    }));

    const absenteeismPercentage = monthlyTrend.length > 0
      ? monthlyTrend[monthlyTrend.length - 1].absenteeismPercentage
      : 0;
    const priorMonthPercentage = monthlyTrend.length > 1
      ? monthlyTrend[monthlyTrend.length - 2].absenteeismPercentage
      : absenteeismPercentage;
    const delta = Number((absenteeismPercentage - priorMonthPercentage).toFixed(2));
    const trend = delta === 0
      ? 'Flat (0.00%)'
      : `${delta < 0 ? 'Improving' : 'Worsening'} (${delta > 0 ? '+' : ''}${delta}%)`;

    // Per-site absenteeism breakdown for the current & prior month (SRS FR-3: "aggregated
    // by sector, AGM, SM and site"). Each row carries sector/region so the client can roll
    // these up into a sector/region summary without a second round trip.
    const breakdownRes = await query(
      `WITH current_absence AS (
         SELECT site_id, COUNT(*) AS cnt FROM absence_logs
         WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
         GROUP BY site_id
       ),
       prior_absence AS (
         SELECT site_id, COUNT(*) AS cnt FROM absence_logs
         WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
         GROUP BY site_id
       ),
       current_late AS (
         SELECT site_id, COUNT(*) AS cnt FROM late_logs
         WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
         GROUP BY site_id
       )
       SELECT s.site_id AS "siteId", s.name, s.sector, s.region,
              (SELECT u.name FROM users u WHERE u.role = 'AGM' AND u.region = s.region ORDER BY u.epf LIMIT 1) AS agm,
              (SELECT u.name FROM users u WHERE u.role = 'SM' AND u.sector = s.sector ORDER BY u.epf LIMIT 1) AS sm,
              s.required_officers AS "requiredOfficers",
              COALESCE(ca.cnt, 0) AS "currentAbsenceCount",
              COALESCE(pa.cnt, 0) AS "priorAbsenceCount",
              COALESCE(cl.cnt, 0) AS "currentLateCount"
       FROM sites s
       LEFT JOIN current_absence ca ON ca.site_id = s.site_id
       LEFT JOIN prior_absence pa ON pa.site_id = s.site_id
       LEFT JOIN current_late cl ON cl.site_id = s.site_id
       WHERE s.site_id IN (${scopeSubquery})
       ORDER BY s.name ASC`,
      params
    );

    const siteBreakdown = breakdownRes.rows.map(r => {
      const required = parseInt(r.requiredOfficers, 10) || 0;
      const pct = (count) => required > 0 ? Number(((count / (required * 30)) * 100).toFixed(2)) : 0;
      return {
        siteId: r.siteId,
        name: r.name,
        sector: r.sector,
        region: r.region,
        agm: r.agm || null,
        sm: r.sm || null,
        requiredOfficers: required,
        currentAbsenceCount: parseInt(r.currentAbsenceCount, 10),
        currentAbsenteeismPercentage: pct(parseInt(r.currentAbsenceCount, 10)),
        priorAbsenceCount: parseInt(r.priorAbsenceCount, 10),
        priorAbsenteeismPercentage: pct(parseInt(r.priorAbsenceCount, 10)),
        currentLateCount: parseInt(r.currentLateCount, 10)
      };
    });

    // Optional custom period (UC-1 step 5): absences/lates per site between from and to,
    // using the same guard-days approximation over the number of days in the range.
    let rangeSummary = null;
    if (range) {
      const n = params.length;
      const rangeRes = await query(
        `SELECT s.site_id AS "siteId",
                (SELECT COUNT(*) FROM absence_logs a WHERE a.site_id = s.site_id AND a.date BETWEEN $${n + 1} AND $${n + 2}) AS absences,
                (SELECT COUNT(*) FROM late_logs l WHERE l.site_id = s.site_id AND l.date BETWEEN $${n + 1} AND $${n + 2}) AS lates
         FROM sites s WHERE s.site_id IN (${scopeSubquery})`,
        [...params, range.from, range.to]
      );
      const bySite = new Map(rangeRes.rows.map(r => [r.siteId, r]));
      let absences = 0;
      let lates = 0;
      for (const site of siteBreakdown) {
        const r = bySite.get(site.siteId);
        const a = r ? parseInt(r.absences, 10) : 0;
        const l = r ? parseInt(r.lates, 10) : 0;
        site.rangeAbsenceCount = a;
        site.rangeLateCount = l;
        site.rangeAbsenteeismPercentage = site.requiredOfficers > 0
          ? Number(((a / (site.requiredOfficers * range.days)) * 100).toFixed(2))
          : 0;
        absences += a;
        lates += l;
      }
      rangeSummary = {
        from: range.from,
        to: range.to,
        days: range.days,
        absenceCount: absences,
        lateCount: lates,
        absenteeismPercentage: totalRequired > 0
          ? Number(((absences / (totalRequired * range.days)) * 100).toFixed(2))
          : 0
      };
    }

    return res.json({
      kpis: {
        range: rangeSummary,
        totalRequired,
        totalOnDuty,
        totalShortfall,
        totalAbsenceCount,
        totalLateCount,
        absenteeismPercentage,
        priorMonthPercentage,
        trend,
        monthlyTrend,
        siteBreakdown
      }
    });
  } catch (error) {
    console.error('KPI calculation error:', error);
    return res.status(500).json({ error: 'Failed to compute executive KPIs' });
  }
});

export default router;
