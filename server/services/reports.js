import { query } from '../db/pool.js';
import { siteScope } from '../middleware/scope.js';

/**
 * The eight automatically generated daily reports (SRS FR-18).
 *
 * Every report has the same shape so one table renderer, one CSV exporter and one archive
 * job serve them all:
 *   { type, title, date, generatedAt, columns: [{ key, label }], rows: [{...}] }
 *
 * Reports are always scoped through siteScope(user): an AGM's Daily Attendance Report only
 * contains their region. The nightly archive builds the organisation-wide copy by passing
 * SYSTEM_USER (MD scope).
 */

export const TZ = 'Asia/Colombo';

export const REPORT_TYPES = {
  incidents: 'Daily Incident Report',
  attendance: 'Daily Attendance Report',
  visits: 'Site Visit Report',
  complaints: 'Client Complaint Report',
  emergency: 'Emergency Incident Report',
  'night-visits': 'Night Visit Report',
  kpi: 'KPI Report',
  operations: 'Daily Operations Summary'
};

/** Organisation-wide scope for the nightly archive. */
export const SYSTEM_USER = Object.freeze({ epf: 'SYSTEM', name: 'System', role: 'MD', region: 'All Sri Lanka', sector: 'All Sectors' });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isValidDate = (s) => {
  if (!DATE_RE.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Today's date (YYYY-MM-DD) in the operating time zone. */
export const localDate = (when = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(when);

const localDay = (column) => `(${column} AT TIME ZONE '${TZ}')::date`;
const clock = (column) => `to_char(${column} AT TIME ZONE '${TZ}', 'HH24:MI')`;

const col = (key, label) => ({ key, label });
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : 'Unknown');

// ---------------------------------------------------------------------------------------------
// Tabular reports
// ---------------------------------------------------------------------------------------------

const attendance = async (user, date) => {
  const scope = siteScope(user);
  const params = [...scope.params, date];
  const d = `$${params.length}::date`;
  const result = await query(
    `SELECT s.name AS site, s.sector, s.required_officers::int AS required,
            (SELECT COUNT(DISTINCT a.epf) FROM duty_attendance a WHERE a.site_id = s.site_id AND a.date = ${d})::int AS "checkedIn",
            (SELECT COUNT(*) FROM absence_logs l WHERE l.site_id = s.site_id AND l.date = ${d})::int AS absences,
            (SELECT COUNT(*) FROM late_logs l WHERE l.site_id = s.site_id AND l.date = ${d})::int AS late
     FROM sites s WHERE s.site_id IN (${scope.sql}) ORDER BY s.name`,
    params
  );
  const rows = result.rows.map((r) => ({ ...r, shortfall: Math.max(0, r.required - r.checkedIn) }));
  const sum = (key) => rows.reduce((total, r) => total + r[key], 0);
  if (rows.length > 0) {
    rows.push({ site: 'TOTAL', sector: '', required: sum('required'), checkedIn: sum('checkedIn'), absences: sum('absences'), late: sum('late'), shortfall: sum('shortfall') });
  }
  return {
    columns: [col('site', 'Site'), col('sector', 'Sector'), col('required', 'Required'), col('checkedIn', 'Checked in'),
      col('shortfall', 'Shortfall'), col('absences', 'Absences'), col('late', 'Late')],
    rows
  };
};

const incidentRows = async (user, date, extraWhere = '') => {
  const scope = siteScope(user);
  const params = [...scope.params, date];
  const result = await query(
    `SELECT incident_id AS id, ${clock('created_at')} AS time, category, sub_type AS "subType", severity,
            site_name AS site, status, description, reported_by AS "reportedBy",
            police_notified, hospital_notified, fire_notified,
            CASE WHEN closed_at IS NULL THEN NULL
                 ELSE ROUND(EXTRACT(EPOCH FROM (closed_at - created_at)) / 60)::int END AS "minutesToClose"
     FROM incidents
     WHERE site_id IN (${scope.sql}) AND ${localDay('created_at')} = $${params.length}::date ${extraWhere}
     ORDER BY created_at`,
    params
  );
  return result.rows;
};

const incidents = async (user, date) => ({
  columns: [col('time', 'Time'), col('id', 'Incident'), col('category', 'Category'), col('subType', 'Type'), col('severity', 'Severity'),
    col('site', 'Site'), col('status', 'Status'), col('description', 'Description'), col('reportedBy', 'Reported by')],
  rows: await incidentRows(user, date)
});

const emergency = async (user, date) => {
  const rows = (await incidentRows(
    user, date,
    `AND (severity = 'Critical' OR police_notified OR hospital_notified OR fire_notified)`
  )).map((r) => ({
    ...r,
    services: [r.police_notified && 'Police', r.hospital_notified && 'Hospital/ambulance', r.fire_notified && 'Fire brigade'].filter(Boolean).join(', ') || 'None'
  }));
  return {
    columns: [col('time', 'Time'), col('id', 'Incident'), col('category', 'Category'), col('severity', 'Severity'), col('site', 'Site'),
      col('services', 'Services called'), col('status', 'Status'), col('minutesToClose', 'Minutes to close'), col('description', 'Description')],
    rows
  };
};

const visitRows = async (user, date, extraWhere = '') => {
  const scope = siteScope(user);
  const params = [...scope.params, date];
  const result = await query(
    `SELECT officer_name AS officer, officer_role AS role, site_name AS site,
            ${clock('arrived_at')} AS arrived,
            CASE WHEN departed_at IS NULL THEN 'In progress' ELSE ${clock('departed_at')} END AS departed,
            duration_minutes AS minutes, travel_km::float AS "travelKm", on_site
     FROM site_visits
     WHERE site_id IN (${scope.sql}) AND ${localDay('arrived_at')} = $${params.length}::date ${extraWhere}
     ORDER BY arrived_at`,
    params
  );
  return result.rows.map(({ on_site: onSite, ...r }) => ({ ...r, onSite: yesNo(onSite) }));
};

const VISIT_COLUMNS = [col('officer', 'Officer'), col('role', 'Role'), col('site', 'Site'), col('arrived', 'Arrived'), col('departed', 'Departed'),
  col('minutes', 'Minutes on site'), col('travelKm', 'Travel (km)'), col('onSite', 'On site')];

const visits = async (user, date) => ({ columns: VISIT_COLUMNS, rows: await visitRows(user, date) });

const nightVisits = async (user, date) => ({
  columns: VISIT_COLUMNS,
  rows: await visitRows(
    user, date,
    `AND (officer_role = 'NVO'
          OR EXTRACT(HOUR FROM arrived_at AT TIME ZONE '${TZ}') >= 18
          OR EXTRACT(HOUR FROM arrived_at AT TIME ZONE '${TZ}') < 6)`
  )
});

const complaints = async (user, date) => {
  const scope = siteScope(user);
  const params = [...scope.params, date];
  const result = await query(
    `SELECT ${clock('created_at')} AS time, site_name AS site, client_name AS client,
            overall_rating AS rating, complaints AS complaint, status, resolution_notes AS "resolutionNotes"
     FROM client_feedback
     WHERE site_id IN (${scope.sql}) AND is_complaint AND ${localDay('created_at')} = $${params.length}::date
     ORDER BY created_at`,
    params
  );
  return {
    columns: [col('time', 'Time'), col('site', 'Site'), col('client', 'Client'), col('rating', 'Overall rating'),
      col('complaint', 'Complaint'), col('status', 'Status'), col('resolutionNotes', 'Resolution')],
    rows: result.rows.map((r) => ({ ...r, resolutionNotes: r.resolutionNotes || '' }))
  };
};

// ---------------------------------------------------------------------------------------------
// Metric reports (KPI Report, Daily Operations Summary)
// ---------------------------------------------------------------------------------------------

const metrics = async (user, date) => {
  const scope = siteScope(user);
  const p = [...scope.params, date];
  const d = `$${p.length}::date`;
  const inScope = `site_id IN (${scope.sql})`;
  const one = async (sql) => (await query(sql, p)).rows[0];

  // This one has no date placeholder, so it takes the scope parameters only.
  const required = (await query(`SELECT COALESCE(SUM(required_officers), 0)::int AS n FROM sites WHERE ${inScope}`, scope.params)).rows[0].n;
  const checkedIn = (await one(`SELECT COUNT(DISTINCT epf)::int AS n FROM duty_attendance WHERE ${inScope} AND date = ${d}`)).n;
  const absences = (await one(`SELECT COUNT(*)::int AS n FROM absence_logs WHERE ${inScope} AND date = ${d}`)).n;
  const late = (await one(`SELECT COUNT(*)::int AS n FROM late_logs WHERE ${inScope} AND date = ${d}`)).n;

  // "Open at the end of that day": reported by then and not closed until after it.
  const endOfDay = `((${d} + 1)::timestamp AT TIME ZONE '${TZ}')`;
  const open = await one(
    `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE severity = 'Critical')::int AS critical
     FROM incidents WHERE ${inScope} AND created_at < ${endOfDay} AND (closed_at IS NULL OR closed_at >= ${endOfDay})`
  );
  const reported = (await one(`SELECT COUNT(*)::int AS n FROM incidents WHERE ${inScope} AND ${localDay('created_at')} = ${d}`)).n;
  const closed = (await one(`SELECT COUNT(*)::int AS n FROM incidents WHERE ${inScope} AND closed_at IS NOT NULL AND ${localDay('closed_at')} = ${d}`)).n;
  const visitCount = (await one(`SELECT COUNT(*)::int AS n FROM site_visits WHERE ${inScope} AND ${localDay('arrived_at')} = ${d}`)).n;
  const nightCount = (await one(
    `SELECT COUNT(*)::int AS n FROM site_visits WHERE ${inScope} AND ${localDay('arrived_at')} = ${d}
       AND (officer_role = 'NVO' OR EXTRACT(HOUR FROM arrived_at AT TIME ZONE '${TZ}') >= 18 OR EXTRACT(HOUR FROM arrived_at AT TIME ZONE '${TZ}') < 6)`
  )).n;
  const feedback = await one(
    `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE is_complaint)::int AS complaints,
            ROUND(AVG(overall_rating), 2)::float AS average
     FROM client_feedback WHERE ${inScope} AND ${localDay('created_at')} = ${d}`
  );

  const absenteeism = required > 0 ? Number(((absences / required) * 100).toFixed(2)) : 0;
  return {
    required, checkedIn, shortfall: Math.max(0, required - checkedIn), absences, late, absenteeism,
    openIncidents: open.n, criticalOpen: open.critical, reported, closed,
    visits: visitCount, nightVisits: nightCount,
    feedback: feedback.n, complaints: feedback.complaints, averageRating: feedback.average
  };
};

const metricRows = (pairs) => pairs.map(([section, metric, value]) => ({ section, metric, value }));

const kpi = async (user, date) => {
  const m = await metrics(user, date);
  return {
    columns: [col('metric', 'KPI'), col('value', 'Value')],
    rows: [
      ['Officers required', m.required], ['Officers checked in', m.checkedIn], ['Shortfall', m.shortfall],
      ['Guard absences', m.absences], ['Absenteeism that day (%)', m.absenteeism], ['Late reports', m.late],
      ['Incidents open at end of day', m.openIncidents], ['Site visits', m.visits]
    ].map(([metric, value]) => ({ metric, value }))
  };
};

const operations = async (user, date) => {
  const m = await metrics(user, date);
  return {
    columns: [col('section', 'Section'), col('metric', 'Measure'), col('value', 'Value')],
    rows: metricRows([
      ['Staffing', 'Officers required', m.required], ['Staffing', 'Officers checked in', m.checkedIn], ['Staffing', 'Shortfall', m.shortfall],
      ['Staffing', 'Guard absences', m.absences], ['Staffing', 'Absenteeism that day (%)', m.absenteeism], ['Staffing', 'Late reports', m.late],
      ['Incidents', 'Reported today', m.reported], ['Incidents', 'Closed today', m.closed],
      ['Incidents', 'Open at end of day', m.openIncidents], ['Incidents', 'Critical open at end of day', m.criticalOpen],
      ['Field', 'Site visits', m.visits], ['Field', 'Night visits', m.nightVisits],
      ['Clients', 'Feedback received', m.feedback], ['Clients', 'Complaints', m.complaints],
      ['Clients', 'Average overall rating', m.averageRating ?? '—']
    ])
  };
};

const BUILDERS = { incidents, attendance, visits, complaints, emergency, 'night-visits': nightVisits, kpi, operations };

/** Builds one report for a role-scoped user on a date. Throws on an unknown type or bad date. */
export const buildReport = async (type, date, user) => {
  if (!Object.hasOwn(BUILDERS, type)) throw new Error(`Unknown report type: ${type}`);
  if (!isValidDate(date)) throw new Error(`Invalid report date: ${date}`);
  const body = await BUILDERS[type](user, date);
  return { type, title: REPORT_TYPES[type], date, generatedAt: new Date().toISOString(), ...body };
};
