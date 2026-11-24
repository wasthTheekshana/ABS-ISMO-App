import express from 'express';
import pool, { query } from '../db/pool.js';
import { validatePayload, authenticate, requireRole } from '../middleware/security.js';
import { siteScope, requireSiteInScope, isSiteInScope } from '../middleware/scope.js';
import { INCIDENT_REPORT_ROLES, INCIDENT_MANAGE_ROLES, INCIDENT_READ_ROLES } from '../middleware/roles.js';
import { makeRecordId } from '../utils/ids.js';

const router = express.Router();

const CATEGORIES = ['Operational', 'Security', 'Safety', 'Medical'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES = ['Open & Investigating', 'Escalated', 'Closed'];
const validCoord = (v, limit) => v === undefined || v === null || v === '' || (Number.isFinite(Number(v)) && Math.abs(Number(v)) <= limit);

const COLUMNS = `incident_id AS "incidentId", category, sub_type AS "subType",
                 severity, site_id AS "siteId", site_name AS "siteName",
                 description, gps_lat AS "gpsLat", gps_lng AS "gpsLng",
                 photo_urls AS "photoUrls", witness_details AS "witnessDetails",
                 client_rep_details AS "clientRepDetails",
                 action_taken AS "actionTaken", police_notified AS "policeNotified",
                 hospital_notified AS "hospitalNotified", fire_notified AS "fireNotified",
                 estimated_loss AS "estimatedLoss", reported_by AS "reportedBy",
                 status, closed_at AS "closedAt", closed_by AS "closedBy",
                 closure_notes AS "closureNotes", updated_at AS "updatedAt",
                 created_at AS "createdAt"`;

/** A client sees that an incident happened and how it ended, not internal detail. */
const redactForClient = (row) => {
  const { gpsLat, gpsLng, witnessDetails, clientRepDetails, estimatedLoss, reportedBy, photoUrls, ...rest } = row;
  return rest;
};

// GET /api/incidents/list?category=...&siteId=...
router.get('/list', authenticate, requireRole(...INCIDENT_READ_ROLES), async (req, res) => {
  try {
    const { category, siteId } = req.query;

    // Only incidents at sites inside the caller's scope (SRS FR-6).
    const scope = siteScope(req.user);
    const params = [...scope.params];

    let sql = `SELECT ${COLUMNS} FROM incidents WHERE site_id IN (${scope.sql})`;

    // A guard sees only what they reported themselves.
    if (req.user.role === 'SECURITY_GUARD') {
      params.push(`${req.user.epf} (`);
      sql += ` AND starts_with(reported_by, $${params.length})`;
    }
    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }
    if (siteId) {
      params.push(siteId);
      sql += ` AND site_id = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC`;

    const result = await query(sql, params);
    const incidents = req.user.role === 'CLIENT' ? result.rows.map(redactForClient) : result.rows;
    return res.json({ incidents });
  } catch (error) {
    console.error('Fetch incidents error:', error);
    return res.status(500).json({ error: 'Failed to fetch incident log' });
  }
});

// POST /api/incidents/report
router.post('/report', authenticate, requireRole(...INCIDENT_REPORT_ROLES), validatePayload(['category', 'subType', 'siteId', 'siteName', 'description']), requireSiteInScope, async (req, res) => {
  try {
    const {
      category,
      subType,
      severity,
      siteId,
      siteName,
      description,
      gpsLat,
      gpsLng,
      photoUrls,
      witnessDetails,
      clientRepDetails,
      actionTaken,
      policeNotified,
      hospitalNotified,
      fireNotified,
      estimatedLoss
    } = req.body;
    // Reporter identity is the authenticated caller, never a client-supplied value —
    // otherwise any caller could attribute a report to someone else.
    const reportedBy = `${req.user.epf} (${req.user.name})`;

    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
    }
    if (severity !== undefined && severity !== null && !SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `severity must be one of: ${SEVERITIES.join(', ')}` });
    }
    if (!validCoord(gpsLat, 90) || !validCoord(gpsLng, 180)) {
      return res.status(400).json({ error: 'gpsLat must be within ±90 and gpsLng within ±180' });
    }
    if (estimatedLoss !== undefined && estimatedLoss !== null && estimatedLoss !== '' && !(Number(estimatedLoss) >= 0)) {
      return res.status(400).json({ error: 'estimatedLoss must be a non-negative number' });
    }

    const catPrefix = category ? category.slice(0, 3).toUpperCase() : 'INC';
    const incidentId = makeRecordId(`INC-${catPrefix}`);

    await query(
      `INSERT INTO incidents (
         incident_id, category, sub_type, severity, site_id, site_name,
         description, gps_lat, gps_lng, photo_urls, witness_details, client_rep_details,
         action_taken, police_notified, hospital_notified, fire_notified,
         estimated_loss, reported_by, status, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)`,
      [
        incidentId,
        category,
        subType,
        severity || 'Medium',
        siteId,
        siteName,
        description,
        gpsLat || null,
        gpsLng || null,
        photoUrls || [],
        witnessDetails || '',
        clientRepDetails || '',
        actionTaken || '',
        Boolean(policeNotified),
        Boolean(hospitalNotified),
        Boolean(fireNotified),
        parseFloat(estimatedLoss || '0'),
        reportedBy,
        'Open & Investigating'
      ]
    );

    return res.status(201).json({
      message: 'Incident reported successfully',
      incidentId
    });
  } catch (error) {
    console.error('Report incident error:', error);
    return res.status(500).json({ error: 'Failed to record incident report' });
  }
});

// ---------------------------------------------------------------------------
// Editing, closure and the audit trail (SRS FR-13, NFR-5)
// ---------------------------------------------------------------------------

const asText = (v) => String(v ?? '').trim();
const EDITABLE = {
  severity: { col: 'severity', norm: asText, valid: (v) => SEVERITIES.includes(v), msg: `severity must be one of: ${SEVERITIES.join(', ')}` },
  description: { col: 'description', norm: asText, valid: (v) => v.length > 0, msg: 'description cannot be empty' },
  actionTaken: { col: 'action_taken', norm: asText },
  witnessDetails: { col: 'witness_details', norm: asText },
  clientRepDetails: { col: 'client_rep_details', norm: asText },
  policeNotified: { col: 'police_notified', norm: Boolean },
  hospitalNotified: { col: 'hospital_notified', norm: Boolean },
  fireNotified: { col: 'fire_notified', norm: Boolean },
  estimatedLoss: { col: 'estimated_loss', norm: Number, valid: (v) => Number.isFinite(v) && v >= 0, msg: 'estimatedLoss must be a non-negative number' }
};

/**
 * Loads the incident FOR UPDATE inside an open transaction and enforces site scope.
 * Sends the error response and returns null when the caller may not proceed.
 */
const lockIncident = async (db, req, res) => {
  const found = await db.query('SELECT * FROM incidents WHERE incident_id = $1 FOR UPDATE', [req.params.id]);
  if (found.rows.length === 0) {
    res.status(404).json({ error: 'Incident not found' });
    return null;
  }
  if (!(await isSiteInScope(req.user, found.rows[0].site_id))) {
    res.status(403).json({ error: 'This site is outside your assigned scope' });
    return null;
  }
  return found.rows[0];
};

const writeAudit = (db, incidentId, user, field, oldValue, newValue) =>
  db.query(
    `INSERT INTO incident_audit (incident_id, changed_by, field, old_value, new_value) VALUES ($1, $2, $3, $4, $5)`,
    [incidentId, `${user.epf} (${user.name})`, field, oldValue === null ? null : String(oldValue), newValue === null ? null : String(newValue)]
  );

// PATCH /api/incidents/:id — edit details. Closed incidents must be reopened first.
router.patch('/:id', authenticate, requireRole(...INCIDENT_MANAGE_ROLES), async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const next = {};
  for (const [key, spec] of Object.entries(EDITABLE)) {
    if (body[key] === undefined) continue;
    const value = spec.norm(body[key]);
    if (spec.valid && !spec.valid(value)) return res.status(400).json({ error: spec.msg });
    next[key] = value;
  }
  if (Object.keys(next).length === 0) {
    return res.status(400).json({ error: `Provide at least one of: ${Object.keys(EDITABLE).join(', ')}` });
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await lockIncident(db, req, res);
    if (!current) { await db.query('ROLLBACK'); return undefined; }
    if (current.status === 'Closed') {
      await db.query('ROLLBACK');
      return res.status(409).json({ error: 'This incident is closed. Reopen it before editing.' });
    }

    const changed = [];
    for (const [key, value] of Object.entries(next)) {
      const spec = EDITABLE[key];
      const before = spec.norm(current[spec.col]);
      if (before === value) continue;
      await db.query(`UPDATE incidents SET ${spec.col} = $1 WHERE incident_id = $2`, [value, current.incident_id]);
      await writeAudit(db, current.incident_id, req.user, key, before, value);
      changed.push(key);
    }
    if (changed.length > 0) {
      await db.query('UPDATE incidents SET updated_at = CURRENT_TIMESTAMP WHERE incident_id = $1', [current.incident_id]);
    }
    await db.query('COMMIT');
    return res.json({ message: changed.length ? 'Incident updated' : 'No changes', changed });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Edit incident error:', error);
    return res.status(500).json({ error: 'Failed to update incident' });
  } finally {
    db.release();
  }
});

// PATCH /api/incidents/:id/status — escalate, close (notes required) or reopen.
router.patch('/:id/status', authenticate, requireRole(...INCIDENT_MANAGE_ROLES), async (req, res) => {
  const status = req.body?.status;
  const closureNotes = asText(req.body?.closureNotes);
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }
  if (status === 'Closed' && closureNotes.length === 0) {
    return res.status(400).json({ error: 'closureNotes are required to close an incident' });
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await lockIncident(db, req, res);
    if (!current) { await db.query('ROLLBACK'); return undefined; }
    if (current.status === status) {
      await db.query('ROLLBACK');
      return res.status(409).json({ error: `Incident is already ${status}` });
    }

    const closing = status === 'Closed';
    const who = `${req.user.epf} (${req.user.name})`;
    await db.query(
      `UPDATE incidents
       SET status = $1, closed_at = $2, closed_by = $3, closure_notes = $4, updated_at = CURRENT_TIMESTAMP
       WHERE incident_id = $5`,
      [status, closing ? new Date() : null, closing ? who : null, closing ? closureNotes : null, current.incident_id]
    );
    await writeAudit(db, current.incident_id, req.user, 'status', current.status, status);
    if (closing) await writeAudit(db, current.incident_id, req.user, 'closureNotes', current.closure_notes, closureNotes);
    await db.query('COMMIT');
    return res.json({ message: `Incident ${closing ? 'closed' : status === 'Escalated' ? 'escalated' : 'reopened'}`, status });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Incident status error:', error);
    return res.status(500).json({ error: 'Failed to change incident status' });
  } finally {
    db.release();
  }
});

// GET /api/incidents/:id/audit — who changed what, oldest first.
router.get('/:id/audit', authenticate, requireRole(...INCIDENT_MANAGE_ROLES), async (req, res) => {
  try {
    const incident = await query('SELECT site_id FROM incidents WHERE incident_id = $1', [req.params.id]);
    if (incident.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    if (!(await isSiteInScope(req.user, incident.rows[0].site_id))) {
      return res.status(403).json({ error: 'This site is outside your assigned scope' });
    }
    const trail = await query(
      `SELECT changed_by AS "changedBy", changed_at AS "changedAt", field,
              old_value AS "oldValue", new_value AS "newValue"
       FROM incident_audit WHERE incident_id = $1 ORDER BY changed_at ASC, id ASC`,
      [req.params.id]
    );
    return res.json({ audit: trail.rows });
  } catch (error) {
    console.error('Incident audit error:', error);
    return res.status(500).json({ error: 'Failed to load the audit trail' });
  }
});

export default router;
