import express from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRole, validatePayload } from '../middleware/security.js';
import { siteScope, requireSiteInScope, isSiteInScope } from '../middleware/scope.js';
import { FEEDBACK_SUBMIT_ROLES, FEEDBACK_READ_ROLES, FEEDBACK_MANAGE_ROLES } from '../middleware/roles.js';
import { makeRecordId } from '../utils/ids.js';

/**
 * Client feedback after a site visit (SRS FR-16).
 *
 *   GET   /sites         CLIENT: the sites linked to their account
 *   GET   /visits        CLIENT: recent completed visits at those sites (what they can rate)
 *   POST  /              CLIENT: ratings (1-5) for punctuality, discipline, grooming, communication,
 *                        an overall star rating, plus complaints and suggestions
 *   GET   /list          management: feedback in their site scope; CLIENT: only their own
 *   PATCH /:id/status    management: Acknowledged, or Resolved (resolution notes required)
 */
const router = express.Router();

const STATUSES = ['New', 'Acknowledged', 'Resolved'];
const RATING_FIELDS = ['punctuality', 'discipline', 'grooming', 'communication', 'overallRating'];
const MAX_TEXT = 2000;
const RECENT_VISIT_DAYS = 30;

const COLUMNS = `feedback_id AS "feedbackId", site_id AS "siteId", site_name AS "siteName",
  client_name AS "clientName", visit_id AS "visitId", punctuality, discipline, grooming, communication,
  overall_rating AS "overallRating", complaints, suggestions, is_complaint AS "isComplaint",
  status, resolved_at AS "resolvedAt", resolved_by AS "resolvedBy",
  resolution_notes AS "resolutionNotes", created_at AS "createdAt"`;

const isRating = (v) => Number.isInteger(v) && v >= 1 && v <= 5;
const cleanText = (v) => String(v ?? '').trim();

// GET /api/feedback/sites
router.get('/sites', authenticate, requireRole(...FEEDBACK_SUBMIT_ROLES), async (req, res) => {
  try {
    const scope = siteScope(req.user);
    const result = await query(
      `SELECT site_id AS "siteId", name FROM sites WHERE site_id IN (${scope.sql}) ORDER BY name`,
      scope.params
    );
    return res.json({ sites: result.rows });
  } catch (error) {
    console.error('Feedback sites error:', error);
    return res.status(500).json({ error: 'Failed to load your sites' });
  }
});

// GET /api/feedback/visits
router.get('/visits', authenticate, requireRole(...FEEDBACK_SUBMIT_ROLES), async (req, res) => {
  try {
    const scope = siteScope(req.user);
    const params = [...scope.params, req.user.epf];
    const epfParam = `$${params.length}`;
    // Officer EPF and coordinates are deliberately not exposed to a client.
    const result = await query(
      `SELECT v.visit_id AS "visitId", v.site_id AS "siteId", v.site_name AS "siteName",
              v.officer_name AS "officerName", v.officer_role AS "officerRole",
              v.arrived_at AS "arrivedAt", v.departed_at AS "departedAt",
              v.duration_minutes AS "durationMinutes",
              EXISTS (SELECT 1 FROM client_feedback f WHERE f.visit_id = v.visit_id AND f.client_epf = ${epfParam}) AS "hasFeedback"
       FROM site_visits v
       WHERE v.site_id IN (${scope.sql}) AND v.departed_at IS NOT NULL
         AND v.arrived_at > CURRENT_TIMESTAMP - INTERVAL '${RECENT_VISIT_DAYS} days'
       ORDER BY v.arrived_at DESC`,
      params
    );
    return res.json({ visits: result.rows });
  } catch (error) {
    console.error('Feedback visits error:', error);
    return res.status(500).json({ error: 'Failed to load recent visits' });
  }
});

// POST /api/feedback
router.post('/', authenticate, requireRole(...FEEDBACK_SUBMIT_ROLES), validatePayload(['siteId', ...RATING_FIELDS]), requireSiteInScope, async (req, res) => {
  const body = req.body;
  for (const field of RATING_FIELDS) {
    if (!isRating(body[field])) return res.status(400).json({ error: `${field} must be a whole number from 1 to 5` });
  }
  const complaints = cleanText(body.complaints);
  const suggestions = cleanText(body.suggestions);
  if (complaints.length > MAX_TEXT || suggestions.length > MAX_TEXT) {
    return res.status(400).json({ error: `complaints and suggestions are limited to ${MAX_TEXT} characters` });
  }

  try {
    const site = (await query('SELECT name FROM sites WHERE site_id = $1', [body.siteId])).rows[0];
    if (!site) return res.status(404).json({ error: 'Site not found' });

    // Feedback can be tied to one visit, which must have happened at the same site.
    let visitId = null;
    if (body.visitId !== undefined && body.visitId !== null && body.visitId !== '') {
      const visit = (await query('SELECT site_id FROM site_visits WHERE visit_id = $1', [body.visitId])).rows[0];
      if (!visit || visit.site_id !== body.siteId) {
        return res.status(400).json({ error: 'That visit was not at the selected site' });
      }
      visitId = body.visitId;
    }

    const feedbackId = makeRecordId('FB');
    await query(
      `INSERT INTO client_feedback (feedback_id, site_id, site_name, client_epf, client_name, visit_id,
                                    punctuality, discipline, grooming, communication, overall_rating,
                                    complaints, suggestions, is_complaint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [feedbackId, body.siteId, site.name, req.user.epf, req.user.name, visitId,
        body.punctuality, body.discipline, body.grooming, body.communication, body.overallRating,
        complaints, suggestions, complaints.length > 0]
    );
    return res.status(201).json({ message: 'Thank you. Your feedback has been recorded.', feedbackId, isComplaint: complaints.length > 0 });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'You have already given feedback for this visit' });
    }
    console.error('Submit feedback error:', error);
    return res.status(500).json({ error: 'Failed to record your feedback' });
  }
});

// GET /api/feedback/list?status=New&complaints=1
router.get('/list', authenticate, requireRole(...FEEDBACK_READ_ROLES), async (req, res) => {
  try {
    const { status, complaints } = req.query;
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }

    const scope = siteScope(req.user);
    const params = [...scope.params];
    let sql = `SELECT ${COLUMNS} FROM client_feedback WHERE site_id IN (${scope.sql})`;

    // A client only ever sees what they submitted themselves.
    if (req.user.role === 'CLIENT') {
      params.push(req.user.epf);
      sql += ` AND client_epf = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    if (complaints === '1' || complaints === 'true') sql += ' AND is_complaint = TRUE';
    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    return res.json({ feedback: result.rows });
  } catch (error) {
    console.error('List feedback error:', error);
    return res.status(500).json({ error: 'Failed to load client feedback' });
  }
});

// PATCH /api/feedback/:id/status
router.patch('/:id/status', authenticate, requireRole(...FEEDBACK_MANAGE_ROLES), async (req, res) => {
  const status = req.body?.status;
  const notes = cleanText(req.body?.resolutionNotes);
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }
  if (status === 'Resolved' && notes.length === 0) {
    return res.status(400).json({ error: 'resolutionNotes are required to resolve feedback' });
  }
  if (notes.length > MAX_TEXT) return res.status(400).json({ error: `resolutionNotes are limited to ${MAX_TEXT} characters` });

  try {
    const found = (await query('SELECT site_id, status FROM client_feedback WHERE feedback_id = $1', [req.params.id])).rows[0];
    if (!found) return res.status(404).json({ error: 'Feedback not found' });
    if (!(await isSiteInScope(req.user, found.site_id))) {
      return res.status(403).json({ error: 'This site is outside your assigned scope' });
    }
    if (found.status === status) return res.status(409).json({ error: `Feedback is already ${status}` });

    const resolving = status === 'Resolved';
    await query(
      `UPDATE client_feedback
       SET status = $1, resolved_at = $2, resolved_by = $3, resolution_notes = $4
       WHERE feedback_id = $5`,
      [status, resolving ? new Date() : null, resolving ? `${req.user.epf} (${req.user.name})` : null, resolving ? notes : null, req.params.id]
    );
    return res.json({ message: `Feedback marked ${status}`, status });
  } catch (error) {
    console.error('Feedback status error:', error);
    return res.status(500).json({ error: 'Failed to update the feedback' });
  }
});

export default router;
