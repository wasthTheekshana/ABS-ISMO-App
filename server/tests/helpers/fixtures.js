import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../../db/pool.js';
import { TEST_JWT_SECRET } from '../testEnv.js';

export const PASSWORD = 'Test-Passcode-1';

// One user per role, plus a second AGM/SM so cross-scope isolation can be asserted.
export const USERS = {
  MD:    { epf: 'T-MD',    name: 'Test MD',        role: 'MD',           title: 'Managing Director', region: 'All Sri Lanka', sector: 'All Sectors' },
  GM:    { epf: 'T-GM',    name: 'Test GM',        role: 'GM',           title: 'General Manager',   region: 'All Sri Lanka', sector: 'All Sectors' },
  CR:    { epf: 'T-CR',    name: 'Test Control',   role: 'CONTROL_ROOM', title: 'Control Room',      region: 'All Sri Lanka', sector: 'All Sectors' },
  AGM_W: { epf: 'T-AGM-W', name: 'Test AGM West',  role: 'AGM',          title: 'AGM West',          region: 'Western',       sector: 'All Western Sectors' },
  AGM_C: { epf: 'T-AGM-C', name: 'Test AGM Cent',  role: 'AGM',          title: 'AGM Central',       region: 'Central',       sector: 'All Central Sectors' },
  SM_1:  { epf: 'T-SM-1',  name: 'Test SM One',    role: 'SM',           title: 'SM Sector 01',      region: 'Western',       sector: 'Sector 01' },
  SM_2:  { epf: 'T-SM-2',  name: 'Test SM Two',    role: 'SM',           title: 'SM Sector 02',      region: 'Western',       sector: 'Sector 02' },
  VO:    { epf: 'T-VO',    name: 'Test VO',        role: 'VO',           title: 'Visiting Officer',  region: 'Western',       sector: 'Sector 01' },
  NVO:   { epf: 'T-NVO',   name: 'Test NVO',       role: 'NVO',          title: 'Night VO',          region: 'Western',       sector: 'Sector 01' },
  // Guard posted at site A (see GUARDS) and a client linked to site A only (client_sites).
  GUARD: { epf: 'T-G-A1',  name: 'Guard A1',       role: 'SECURITY_GUARD', title: 'Security Guard',  region: 'Western',       sector: 'Sector 01' },
  CLIENT:{ epf: 'T-CLIENT', name: 'Test Client',   role: 'CLIENT',       title: 'Client',            region: 'Western',       sector: 'Sector 01' }
};

// A/B: Western + Sector 01 (VO/NVO assigned to A).  C: Western + Sector 02.  D: Central.
export const SITES = {
  A: { id: 'T-SITE-A', name: 'Site A', sector: 'Sector 01', region: 'Western', required: 10, onDuty: 8,  vo: 'T-VO', nvo: 'T-NVO', lat: 6.9120, lng: 79.8510 },
  B: { id: 'T-SITE-B', name: 'Site B', sector: 'Sector 01', region: 'Western', required: 5,  onDuty: 5,  vo: null,   nvo: null,    lat: 6.9335, lng: 79.8428 },
  C: { id: 'T-SITE-C', name: 'Site C', sector: 'Sector 02', region: 'Western', required: 20, onDuty: 15, vo: null,   nvo: null,    lat: 6.9520, lng: 79.9930 },
  D: { id: 'T-SITE-D', name: 'Site D', sector: 'Sector 04', region: 'Central', required: 15, onDuty: 15, vo: null,   nvo: null,    lat: 7.2937, lng: 80.6411 }
};

export const GUARDS = [
  ['T-G-A1', 'Guard A1', 'Security Guard', SITES.A.id],
  ['T-G-A2', 'Guard A2', 'Security Guard', SITES.A.id],
  ['T-G-B1', 'Guard B1', 'Security Guard', SITES.B.id],
  ['T-G-C1', 'Guard C1', 'Security Guard', SITES.C.id],
  ['T-G-D1', 'Guard D1', 'Security Guard', SITES.D.id]
];

/** Mint a valid token directly (avoids hitting the login rate limiter in every test). */
export const tokenFor = (user, options = { expiresIn: '1h' }) => {
  const { epf, name, role, title, region, sector } = user;
  return jwt.sign({ epf, name, role, title, region, sector }, TEST_JWT_SECRET, options);
};

export const bearer = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

const TRANSACTIONAL = [
  'duty_attendance', 'absence_logs', 'late_logs', 'incidents', 'site_inspections',
  'client_feedback', 'location_pings', 'site_visits', 'daily_reports'
];

/** Empty the per-test transactional tables; master data stays. */
export const clearTransactional = async () => {
  // DELETE (not TRUNCATE): TRUNCATE is far slower per call on Docker-for-Windows volumes.
  for (const table of TRANSACTIONAL) await pool.query(`DELETE FROM ${table}`);
  // Routes mutate sites (absence lowers current_on_duty / sets Alert); restore the baseline
  // so one test's side effects cannot leak into the next.
  for (const s of Object.values(SITES)) {
    await pool.query(
      `UPDATE sites SET current_on_duty = $2, status = 'Optimal' WHERE site_id = $1`,
      [s.id, s.onDuty]
    );
  }
};

/** Reload users, sites and guards in the TEST database (name pinned by setupEnv.js). */
export const seedMasterData = async () => {
  await pool.query(`TRUNCATE ${TRANSACTIONAL.join(', ')}, security_guards, sites, users RESTART IDENTITY CASCADE`);

  const hash = await bcrypt.hash(PASSWORD, 4); // low cost: tests only
  for (const u of Object.values(USERS)) {
    await pool.query(
      `INSERT INTO users (epf, name, role, title, region, sector, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [u.epf, u.name, u.role, u.title, u.region, u.sector, hash]
    );
  }
  for (const s of Object.values(SITES)) {
    await pool.query(
      `INSERT INTO sites (site_id, name, sector, region, required_officers, current_on_duty, assigned_vo, assigned_nvo, status, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Optimal','Test location')`,
      [s.id, s.name, s.sector, s.region, s.required, s.onDuty, s.vo, s.nvo]
    );
  }
  for (const g of GUARDS) {
    await pool.query(`INSERT INTO security_guards (epf, name, rank, site_id) VALUES ($1,$2,$3,$4)`, g);
  }
  await pool.query(`INSERT INTO client_sites (client_epf, site_id) VALUES ($1, $2)`, [USERS.CLIENT.epf, SITES.A.id]);
  for (const s of Object.values(SITES)) {
    await pool.query('UPDATE sites SET lat = $2, lng = $3 WHERE site_id = $1', [s.id, s.lat, s.lng]);
  }
};

export const closePool = () => pool.end();
