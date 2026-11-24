import express from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/security.js';
import { STAFF_ROLES } from '../middleware/roles.js';
import { siteScope } from '../middleware/scope.js';

const router = express.Router();

// GET /api/officers — security guards at sites the caller can see (SRS FR-6 scope),
// replacing the earlier hardcoded/mock officer lists used by the absence & late
// reporting forms.
router.get('/', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const scope = siteScope(req.user);

    const result = await query(
      `SELECT epf, name, rank, site_id AS "siteId"
       FROM security_guards
       WHERE site_id IN (${scope.sql})
       ORDER BY name ASC`,
      scope.params
    );

    return res.json({ officers: result.rows });
  } catch (error) {
    console.error('Error fetching officers:', error);
    return res.status(500).json({ error: 'Failed to retrieve officer roster' });
  }
});

export default router;
