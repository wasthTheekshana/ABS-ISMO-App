/**
 * Role-based site scoping (SRS FR-6).
 *
 * The caller's identity comes ONLY from the verified JWT (req.user). This is the single
 * definition of "which sites can this user see" so list endpoints and write endpoints
 * cannot drift apart.
 *
 *   MD / GM / CONTROL_ROOM -> every site
 *   AGM                    -> sites in their region
 *   SM                     -> sites in their sector
 *   VO / NVO               -> sites assigned to them, plus their sector
 *   SECURITY_GUARD         -> the site they are posted to (security_guards)
 *   CLIENT                 -> sites linked to their account (client_sites)
 */
import { query } from '../db/pool.js';

/**
 * Returns { sql, params } where sql is `SELECT site_id FROM sites WHERE ...` using $1..$n
 * placeholders for params. Embed as `site_id IN (${sql})` and pass params FIRST (or
 * offset yourself) so placeholder numbers line up.
 */
export const siteScope = (user) => {
  const { role, region, sector, epf } = user;
  let sql = 'SELECT site_id FROM sites WHERE 1=1';
  const params = [];

  if (role === 'AGM') {
    params.push(region);
    sql += ` AND region = $${params.length}`;
  } else if (role === 'SM') {
    params.push(sector);
    sql += ` AND sector = $${params.length}`;
  } else if (role === 'VO' || role === 'NVO') {
    params.push(epf);
    params.push(sector);
    sql += ` AND (assigned_vo = $${params.length - 1} OR assigned_nvo = $${params.length - 1} OR sector = $${params.length})`;
  } else if (role === 'SECURITY_GUARD') {
    // A guard only ever sees the one site they are posted to.
    params.push(epf);
    sql += ` AND site_id IN (SELECT site_id FROM security_guards WHERE epf = $${params.length})`;
  } else if (role === 'CLIENT') {
    // A client sees only the sites linked to their account (client_sites).
    params.push(epf);
    sql += ` AND site_id IN (SELECT site_id FROM client_sites WHERE client_epf = $${params.length})`;
  } else if (!['MD', 'GM', 'CONTROL_ROOM'].includes(role)) {
    // Unknown role: fail closed rather than fall through to "see everything".
    sql += ' AND FALSE';
  }

  return { sql, params };
};

/** True when `siteId` is inside the user's visible scope. */
export const isSiteInScope = async (user, siteId) => {
  const { sql, params } = siteScope(user);
  const result = await query(
    `SELECT 1 FROM sites WHERE site_id = $${params.length + 1} AND site_id IN (${sql})`,
    [...params, siteId]
  );
  return result.rows.length > 0;
};

/** Express middleware: 403 unless req.body.siteId is inside the caller's scope. */
export const requireSiteInScope = async (req, res, next) => {
  try {
    if (!(await isSiteInScope(req.user, req.body.siteId))) {
      return res.status(403).json({ error: 'This site is outside your assigned scope' });
    }
    next();
  } catch (error) {
    console.error('Site scope check error:', error);
    return res.status(500).json({ error: 'Failed to verify site access' });
  }
};
