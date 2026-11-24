import express from 'express';
import pool, { query } from '../db/pool.js';
import { authenticate, requireRole, validatePayload } from '../middleware/security.js';
import { siteScope, requireSiteInScope } from '../middleware/scope.js';
import { VISIT_ROLES, LIVE_MAP_ROLES, NVO_LOCATION_ROLES, STAFF_ROLES } from '../middleware/roles.js';
import { makeRecordId } from '../utils/ids.js';
import { haversineMeters, pathKm, parsePoint, GEOFENCE_METERS } from '../utils/geo.js';

/**
 * GPS site visits (SRS FR-14) and the live officer map (FR-8).
 *
 *   POST /arrive        VO/NVO: start a visit (geofence flag, travel since the last visit today)
 *   POST /:id/depart    VO/NVO: end their own open visit (duration, departure fix)
 *   POST /ping          VO/NVO: periodic location while on a round
 *   GET  /mine          VO/NVO: their open visit and today's visits
 *   GET  /list          staff: visits for a day, inside the caller's site scope
 *   GET  /live          MD/GM/AGM/SM/Control Room: latest officer positions + site markers.
 *                       NVO positions are visible to MD and GM only (FR-8).
 */
const router = express.Router();

const TZ = 'Asia/Colombo';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIVE_MINUTES = 30;
const MAX_LIVE_MINUTES = 24 * 60;

const VISIT_COLUMNS = `visit_id AS "visitId", officer_epf AS "officerEpf", officer_name AS "officerName",
  officer_role AS "officerRole", site_id AS "siteId", site_name AS "siteName",
  arrived_at AS "arrivedAt", departed_at AS "departedAt",
  distance_from_site_m AS "distanceFromSiteM", on_site AS "onSite",
  travel_km::float AS "travelKm", duration_minutes AS "durationMinutes", notes`;

const COORDINATE_COLUMNS = `, arrival_lat::float AS "arrivalLat", arrival_lng::float AS "arrivalLng",
  departure_lat::float AS "departureLat", departure_lng::float AS "departureLng"`;

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

const validDate = (s) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// POST /api/visits/arrive
router.post('/arrive', authenticate, requireRole(...VISIT_ROLES), validatePayload(['siteId', 'lat', 'lng']), requireSiteInScope, async (req, res) => {
  const point = parsePoint(req.body.lat, req.body.lng);
  if (!point) return res.status(400).json({ error: 'lat must be within ±90 and lng within ±180' });

  const db = await pool.connect();
  try {
    const site = (await db.query('SELECT name, lat, lng FROM sites WHERE site_id = $1', [req.body.siteId])).rows[0];
    if (!site) return res.status(404).json({ error: 'Site not found' });

    let distanceFromSite = null;
    let onSite = null;
    if (site.lat !== null && site.lng !== null) {
      distanceFromSite = Math.round(haversineMeters(point, { lat: Number(site.lat), lng: Number(site.lng) }));
      onSite = distanceFromSite <= GEOFENCE_METERS;
    }

    // Distance travelled since this officer left their previous site today: the breadcrumb
    // path from the last departure fix, through every ping since, to this arrival fix.
    let travelKm = 0;
    const previous = (await db.query(
      `SELECT departed_at, departure_lat, departure_lng FROM site_visits
       WHERE officer_epf = $1 AND departed_at IS NOT NULL
         AND (departed_at AT TIME ZONE '${TZ}')::date = (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date
       ORDER BY departed_at DESC LIMIT 1`,
      [req.user.epf]
    )).rows[0];
    if (previous && previous.departure_lat !== null && previous.departure_lng !== null) {
      const pings = (await db.query(
        `SELECT lat, lng FROM location_pings WHERE officer_epf = $1 AND recorded_at > $2 ORDER BY recorded_at ASC`,
        [req.user.epf, previous.departed_at]
      )).rows.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
      travelKm = pathKm([{ lat: Number(previous.departure_lat), lng: Number(previous.departure_lng) }, ...pings, point]);
    }

    const visitId = makeRecordId('VISIT');
    await db.query('BEGIN');
    await db.query(
      `INSERT INTO site_visits (visit_id, officer_epf, officer_name, officer_role, site_id, site_name,
                                arrival_lat, arrival_lng, distance_from_site_m, on_site, travel_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [visitId, req.user.epf, req.user.name, req.user.role, req.body.siteId, site.name,
        point.lat, point.lng, distanceFromSite, onSite, Number(travelKm.toFixed(2))]
    );
    await db.query(
      'INSERT INTO location_pings (officer_epf, visit_id, lat, lng) VALUES ($1, $2, $3, $4)',
      [req.user.epf, visitId, point.lat, point.lng]
    );
    await db.query('COMMIT');

    return res.status(201).json({
      message: onSite === false ? 'Arrival recorded, but you are away from the site location' : 'Arrival recorded',
      visitId,
      onSite,
      distanceFromSiteM: distanceFromSite,
      travelKm: Number(travelKm.toFixed(2)),
      geofenceMeters: GEOFENCE_METERS
    });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      const open = await query(`SELECT ${VISIT_COLUMNS} FROM site_visits WHERE officer_epf = $1 AND departed_at IS NULL`, [req.user.epf]);
      return res.status(409).json({
        error: 'You already have a visit in progress. Depart from it first.',
        existingRecord: open.rows[0] || null
      });
    }
    console.error('Visit arrive error:', error);
    return res.status(500).json({ error: 'Failed to record the arrival' });
  } finally {
    db.release();
  }
});

// POST /api/visits/:id/depart
router.post('/:id/depart', authenticate, requireRole(...VISIT_ROLES), async (req, res) => {
  const { lat, lng } = req.body || {};
  const hasPoint = lat !== undefined && lat !== null && lat !== '';
  const point = hasPoint ? parsePoint(lat, lng) : null;
  if (hasPoint && !point) return res.status(400).json({ error: 'lat must be within ±90 and lng within ±180' });
  const notes = String(req.body?.notes ?? '').trim();

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Only the officer's own visit can be closed; anything else looks like it does not exist.
    const found = await db.query('SELECT visit_id, departed_at FROM site_visits WHERE visit_id = $1 AND officer_epf = $2 FOR UPDATE', [req.params.id, req.user.epf]);
    if (found.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Visit not found' });
    }
    if (found.rows[0].departed_at) {
      await db.query('ROLLBACK');
      return res.status(409).json({ error: 'This visit has already ended' });
    }
    const done = await db.query(
      `UPDATE site_visits
       SET departed_at = CURRENT_TIMESTAMP, departure_lat = $2, departure_lng = $3, notes = $4,
           duration_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - arrived_at)) / 60))::int
       WHERE visit_id = $1 RETURNING duration_minutes AS "durationMinutes"`,
      [req.params.id, point?.lat ?? null, point?.lng ?? null, notes]
    );
    if (point) {
      await db.query('INSERT INTO location_pings (officer_epf, visit_id, lat, lng) VALUES ($1, $2, $3, $4)', [req.user.epf, req.params.id, point.lat, point.lng]);
    }
    await db.query('COMMIT');
    return res.json({ message: 'Departure recorded', durationMinutes: done.rows[0].durationMinutes });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Visit depart error:', error);
    return res.status(500).json({ error: 'Failed to record the departure' });
  } finally {
    db.release();
  }
});

// POST /api/visits/ping — periodic location while on a round (attached to the open visit, if any)
router.post('/ping', authenticate, requireRole(...VISIT_ROLES), validatePayload(['lat', 'lng']), async (req, res) => {
  const point = parsePoint(req.body.lat, req.body.lng);
  if (!point) return res.status(400).json({ error: 'lat must be within ±90 and lng within ±180' });
  const accuracy = req.body.accuracy;
  if (accuracy !== undefined && accuracy !== null && !(Number(accuracy) >= 0)) {
    return res.status(400).json({ error: 'accuracy must be a non-negative number of metres' });
  }
  try {
    const open = await query('SELECT visit_id FROM site_visits WHERE officer_epf = $1 AND departed_at IS NULL', [req.user.epf]);
    const saved = await query(
      `INSERT INTO location_pings (officer_epf, visit_id, lat, lng, accuracy_m)
       VALUES ($1, $2, $3, $4, $5) RETURNING recorded_at AS "recordedAt"`,
      [req.user.epf, open.rows[0]?.visit_id ?? null, point.lat, point.lng, accuracy == null ? null : Math.round(Number(accuracy))]
    );
    return res.status(201).json({ message: 'Location recorded', recordedAt: saved.rows[0].recordedAt, visitId: open.rows[0]?.visit_id ?? null });
  } catch (error) {
    console.error('Ping error:', error);
    return res.status(500).json({ error: 'Failed to record the location' });
  }
});

// GET /api/visits/mine
router.get('/mine', authenticate, requireRole(...VISIT_ROLES), async (req, res) => {
  try {
    const today = await query(
      `SELECT ${VISIT_COLUMNS} FROM site_visits
       WHERE officer_epf = $1 AND (arrived_at AT TIME ZONE '${TZ}')::date = (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date
       ORDER BY arrived_at DESC`,
      [req.user.epf]
    );
    const open = await query(`SELECT ${VISIT_COLUMNS} FROM site_visits WHERE officer_epf = $1 AND departed_at IS NULL`, [req.user.epf]);
    return res.json({ open: open.rows[0] || null, today: today.rows });
  } catch (error) {
    console.error('My visits error:', error);
    return res.status(500).json({ error: 'Failed to load your visits' });
  }
});

// GET /api/visits/list?date=YYYY-MM-DD
router.get('/list', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : localToday();
    if (!validDate(date)) return res.status(400).json({ error: 'date must be a valid date (YYYY-MM-DD)' });

    const scope = siteScope(req.user);
    const params = [...scope.params, date];
    // Raw coordinates are limited to the roles that may see officer locations of any kind.
    const columns = NVO_LOCATION_ROLES.includes(req.user.role) ? VISIT_COLUMNS + COORDINATE_COLUMNS : VISIT_COLUMNS;
    const result = await query(
      `SELECT ${columns} FROM site_visits
       WHERE site_id IN (${scope.sql}) AND (arrived_at AT TIME ZONE '${TZ}')::date = $${params.length}::date
       ORDER BY arrived_at DESC`,
      params
    );
    return res.json({ date, visits: result.rows });
  } catch (error) {
    console.error('List visits error:', error);
    return res.status(500).json({ error: 'Failed to load site visits' });
  }
});

// GET /api/visits/live?minutes=30
router.get('/live', authenticate, requireRole(...LIVE_MAP_ROLES), async (req, res) => {
  try {
    const minutes = req.query.minutes === undefined ? DEFAULT_LIVE_MINUTES : Number(req.query.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_LIVE_MINUTES) {
      return res.status(400).json({ error: `minutes must be a whole number between 1 and ${MAX_LIVE_MINUTES}` });
    }

    // FR-8: NVO positions only for MD and GM. Everyone else sees Visiting Officers.
    const roles = NVO_LOCATION_ROLES.includes(req.user.role) ? ['VO', 'NVO'] : ['VO'];
    const params = [minutes, roles];
    let scopeSql = '';
    if (req.user.role === 'AGM') {
      params.push(req.user.region);
      scopeSql = `AND u.region = $${params.length}`;
    } else if (req.user.role === 'SM') {
      params.push(req.user.sector);
      scopeSql = `AND u.sector = $${params.length}`;
    }

    const officers = await query(
      `SELECT DISTINCT ON (p.officer_epf)
              p.officer_epf AS epf, u.name, u.role, p.lat::float AS lat, p.lng::float AS lng,
              p.accuracy_m AS "accuracyM", p.recorded_at AS "recordedAt",
              FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.recorded_at)))::int AS "ageSeconds",
              v.visit_id AS "visitId", v.site_id AS "siteId", v.site_name AS "siteName", v.arrived_at AS "arrivedAt"
       FROM location_pings p
       JOIN users u ON u.epf = p.officer_epf
       LEFT JOIN site_visits v ON v.officer_epf = p.officer_epf AND v.departed_at IS NULL
       WHERE p.recorded_at > CURRENT_TIMESTAMP - ($1 || ' minutes')::interval
         AND u.role = ANY($2) ${scopeSql}
       ORDER BY p.officer_epf, p.recorded_at DESC`,
      params
    );

    const scope = siteScope(req.user);
    const sites = await query(
      `SELECT site_id AS "siteId", name, lat::float AS lat, lng::float AS lng
       FROM sites WHERE lat IS NOT NULL AND lng IS NOT NULL AND site_id IN (${scope.sql}) ORDER BY name`,
      scope.params
    );

    return res.json({
      generatedAt: new Date().toISOString(),
      windowMinutes: minutes,
      geofenceMeters: GEOFENCE_METERS,
      officers: officers.rows,
      sites: sites.rows
    });
  } catch (error) {
    console.error('Live map error:', error);
    return res.status(500).json({ error: 'Failed to load the live map' });
  }
});

export default router;
