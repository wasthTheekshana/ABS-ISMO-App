import express from 'express';
import { query } from '../db/pool.js';
import { validatePayload, authenticate, requireRole } from '../middleware/security.js';
import { siteScope, requireSiteInScope } from '../middleware/scope.js';
import { INSPECTION_SUBMIT_ROLES, INSPECTION_READ_ROLES } from '../middleware/roles.js';
import { makeRecordId } from '../utils/ids.js';

const router = express.Router();

const RATINGS = ['Excellent', 'Good', 'Average', 'Poor'];

/**
 * SRS FR-15 checklist. The first five are the original always-answered items; the rest are
 * stored as NULL when the client did not send them (older apps) or the item does not apply
 * (e.g. weapons at an unarmed site), so they never count as a failed check.
 */
const LEGACY_CHECKS = {
  uniformCheck: 'uniform_check', idCheck: 'id_check', registerCheck: 'register_check',
  cctvCheck: 'cctv_check', fireEqCheck: 'fire_eq_check'
};
const OPTIONAL_CHECKS = {
  presenceCheck: 'presence_check', groomingCheck: 'grooming_check', alarmCheck: 'alarm_check',
  clientSatisfactionCheck: 'client_satisfaction_check', cleanlinessCheck: 'cleanliness_check',
  equipmentCheck: 'equipment_check', weaponsCheck: 'weapons_check'
};
const optionalBool = (v) => (v === undefined || v === null ? null : Boolean(v));

// GET /api/inspections/list?siteId=...
router.get('/list', authenticate, requireRole(...INSPECTION_READ_ROLES), async (req, res) => {
  try {
    const { siteId } = req.query;

    // Only inspections at sites inside the caller's scope (SRS FR-6).
    const scope = siteScope(req.user);
    const params = [...scope.params];

    let sql = `SELECT inspection_id AS "inspectionId", site_id AS "siteId",
                      site_name AS "siteName", inspector_epf AS "inspectorEpf",
                      inspector_name AS "inspectorName", uniform_check AS "uniformCheck",
                      id_check AS "idCheck", register_check AS "registerCheck",
                      cctv_check AS "cctvCheck", fire_eq_check AS "fireEqCheck",
                      presence_check AS "presenceCheck", grooming_check AS "groomingCheck",
                      alarm_check AS "alarmCheck", client_satisfaction_check AS "clientSatisfactionCheck",
                      cleanliness_check AS "cleanlinessCheck", equipment_check AS "equipmentCheck",
                      weapons_check AS "weaponsCheck",
                      site_rating AS "siteRating", remarks, created_at AS "createdAt"
               FROM site_inspections WHERE site_id IN (${scope.sql})`;

    if (siteId) {
      params.push(siteId);
      sql += ` AND site_id = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC`;

    const result = await query(sql, params);
    return res.json({ inspections: result.rows });
  } catch (error) {
    console.error('Fetch inspections error:', error);
    return res.status(500).json({ error: 'Failed to fetch site inspections' });
  }
});

// POST /api/inspections/submit
router.post('/submit', authenticate, requireRole(...INSPECTION_SUBMIT_ROLES), validatePayload(['siteId', 'siteName', 'siteRating']), requireSiteInScope, async (req, res) => {
  try {
    const { siteId, siteName, siteRating, remarks } = req.body;
    if (!RATINGS.includes(siteRating)) {
      return res.status(400).json({ error: `siteRating must be one of: ${RATINGS.join(', ')}` });
    }

    // Inspector identity is the authenticated caller, never a client-supplied value.
    const inspectorEpf = req.user.epf;
    const inspectorName = req.user.name;

    const inspectionId = makeRecordId('INSP');

    const cols = ['inspection_id', 'site_id', 'site_name', 'inspector_epf', 'inspector_name',
      ...Object.values(LEGACY_CHECKS), ...Object.values(OPTIONAL_CHECKS), 'site_rating', 'remarks'];
    const values = [
      inspectionId, siteId, siteName, inspectorEpf, inspectorName,
      ...Object.keys(LEGACY_CHECKS).map((k) => Boolean(req.body[k])),
      ...Object.keys(OPTIONAL_CHECKS).map((k) => optionalBool(req.body[k])),
      siteRating || 'Good',
      remarks || ''
    ];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

    await query(
      `INSERT INTO site_inspections (${cols.join(', ')}, created_at) VALUES (${placeholders}, CURRENT_TIMESTAMP)`,
      values
    );

    return res.status(201).json({
      message: 'Digital site inspection submitted successfully',
      inspectionId
    });
  } catch (error) {
    console.error('Submit inspection error:', error);
    return res.status(500).json({ error: 'Failed to submit site inspection' });
  }
});

export default router;
