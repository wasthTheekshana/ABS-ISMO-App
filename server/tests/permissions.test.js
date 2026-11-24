import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { siteScope } from '../middleware/scope.js';
import {
  seedMasterData, clearTransactional, closePool, bearer, tokenFor, USERS, SITES
} from './helpers/fixtures.js';

/**
 * SRS FR-6 / Sprint 4 permission testing.
 * Every role calls every read endpoint; the set of site IDs in the response must equal
 * exactly the sites that role is allowed to see - no more, no fewer.
 */

const ALL = [SITES.A.id, SITES.B.id, SITES.C.id, SITES.D.id];
const A = SITES.A.id, B = SITES.B.id, C = SITES.C.id, D = SITES.D.id;

// role fixture -> sites it may see
const EXPECTED = [
  ['MD',    USERS.MD,    ALL],
  ['GM',    USERS.GM,    ALL],
  ['CONTROL_ROOM', USERS.CR, ALL],
  ['AGM (Western)', USERS.AGM_W, [A, B, C]],
  ['AGM (Central)', USERS.AGM_C, [D]],
  ['SM (Sector 01)', USERS.SM_1, [A, B]],
  ['SM (Sector 02)', USERS.SM_2, [C]],
  ['VO',   USERS.VO,   [A, B]],
  ['NVO',  USERS.NVO,  [A, B]]
];

// endpoint -> function pulling the site IDs out of the response body
const READ_ENDPOINTS = [
  ['/api/sites',            (b) => b.sites.map((r) => r.siteId)],
  ['/api/officers',         (b) => b.officers.map((r) => r.siteId)],
  ['/api/absence/logs',     (b) => b.absenceLogs.map((r) => r.siteId)],
  ['/api/late/logs',        (b) => b.lateLogs.map((r) => r.siteId)],
  ['/api/incidents/list',   (b) => b.incidents.map((r) => r.siteId)],
  ['/api/inspections/list', (b) => b.inspections.map((r) => r.siteId)],
  ['/api/kpis/executive',   (b) => b.kpis.siteBreakdown.map((r) => r.siteId)]
];

const unique = (xs) => [...new Set(xs)].sort();

beforeAll(async () => {
  await seedMasterData();
  await clearTransactional();

  // One record of every kind at every site, so a leak from any site is detectable.
  for (const [i, s] of Object.values(SITES).entries()) {
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
       VALUES ($1,$2,'Seed Guard',$3,$4,CURRENT_DATE,'Day','Sick','seed')`,
      [`ABS-SEED-${i}`, `SEED-${i}`, s.id, s.name]
    );
    await pool.query(
      `INSERT INTO late_logs (log_id, epf, officer_name, site_id, site_name, date, shift, scheduled_time, actual_time, delay_minutes, reason, submitted_by)
       VALUES ($1,$2,'Seed Guard',$3,$4,CURRENT_DATE,'Day','06:00','06:30',30,'Traffic','seed')`,
      [`LATE-SEED-${i}`, `SEED-${i}`, s.id, s.name]
    );
    await pool.query(
      `INSERT INTO incidents (incident_id, category, sub_type, site_id, site_name, description, reported_by)
       VALUES ($1,'Security','Theft',$2,$3,'seed','seed')`,
      [`INC-SEED-${i}`, s.id, s.name]
    );
    await pool.query(
      `INSERT INTO site_inspections (inspection_id, site_id, site_name, inspector_epf, inspector_name)
       VALUES ($1,$2,$3,'seed','seed')`,
      [`INSP-SEED-${i}`, s.id, s.name]
    );
  }
});
afterAll(closePool);

describe('read endpoints return only the caller\'s scope', () => {
  for (const [path, extract] of READ_ENDPOINTS) {
    describe(`GET ${path}`, () => {
      it.each(EXPECTED)('%s sees exactly its own sites', async (_label, user, expectedSites) => {
        const res = await request(app).get(path).set(bearer(user));

        expect(res.status).toBe(200);
        expect(unique(extract(res.body))).toEqual([...expectedSites].sort());
      });
    });
  }
});

describe('scope cannot be widened by the client', () => {
  it.each(READ_ENDPOINTS)('GET %s ignores role/region/sector query parameters', async (path, extract) => {
    const res = await request(app)
      .get(path)
      .query({ role: 'MD', region: 'All Sri Lanka', sector: 'Sector 04', epf: USERS.MD.epf })
      .set(bearer(USERS.SM_2));

    expect(res.status).toBe(200);
    expect(unique(extract(res.body))).toEqual([C]);
  });

  it('filtering incidents by a site outside scope returns nothing, not that site\'s data', async () => {
    const res = await request(app).get('/api/incidents/list').query({ siteId: D }).set(bearer(USERS.SM_1));

    expect(res.status).toBe(200);
    expect(res.body.incidents).toEqual([]);
  });

  it('filtering inspections by a site outside scope returns nothing', async () => {
    const res = await request(app).get('/api/inspections/list').query({ siteId: D }).set(bearer(USERS.AGM_W));

    expect(res.status).toBe(200);
    expect(res.body.inspections).toEqual([]);
  });

  it.each(READ_ENDPOINTS)('GET %s: a token with an unknown role is refused (fails closed)', async (path) => {
    const stranger = tokenFor({ ...USERS.MD, role: 'INTERN' });
    const res = await request(app).get(path).set('Authorization', `Bearer ${stranger}`);

    expect(res.status).toBe(403);
  });

  it('siteScope itself matches no site for an unknown role (second line of defence)', () => {
    const { sql } = siteScope({ ...USERS.MD, role: 'INTERN' });
    expect(sql).toMatch(/AND FALSE$/);
  });

  it('KPI totals for a scoped role cover only that scope (SM Sector 01 = sites A + B)', async () => {
    const res = await request(app).get('/api/kpis/executive').set(bearer(USERS.SM_1));

    expect(res.body.kpis.totalRequired).toBe(SITES.A.required + SITES.B.required);
    expect(res.body.kpis.totalAbsenceCount).toBe(2);
    expect(res.body.kpis.totalLateCount).toBe(2);
  });
});

describe('every endpoint rejects unauthenticated callers', () => {
  const GETS = [...READ_ENDPOINTS.map(([p]) => p), '/api/attendance/mine', '/api/auth/me'];
  const POSTS = [
    '/api/absence/log', '/api/late/log', '/api/incidents/report', '/api/inspections/submit',
    '/api/attendance/check-in', '/api/attendance/check-out'
  ];

  it.each(GETS)('GET %s -> 401 without a token', async (path) => {
    expect((await request(app).get(path)).status).toBe(401);
  });

  it.each(POSTS)('POST %s -> 401 without a token', async (path) => {
    expect((await request(app).post(path).send({})).status).toBe(401);
  });
});

describe('write endpoints enforce site scope', () => {
  const absence = (site, guard) => ({
    epf: guard, officerName: 'Guard', siteId: site.id, siteName: site.name,
    date: '2026-01-15', shift: 'Day', reason: 'Sick'
  });

  it('SM of Sector 01 may log absence at site A', async () => {
    const res = await request(app).post('/api/absence/log').set(bearer(USERS.SM_1)).send(absence(SITES.A, 'T-G-A1'));
    expect(res.status).toBe(201);
  });

  it('SM of Sector 01 may NOT log absence at site C (Sector 02) -> 403', async () => {
    const res = await request(app).post('/api/absence/log').set(bearer(USERS.SM_1)).send(absence(SITES.C, 'T-G-C1'));
    expect(res.status).toBe(403);
  });

  it('AGM Central may NOT log absence at a Western site -> 403', async () => {
    const res = await request(app).post('/api/absence/log').set(bearer(USERS.AGM_C)).send(absence(SITES.A, 'T-G-A1'));
    expect(res.status).toBe(403);
  });

  it('a rejected out-of-scope absence write leaves no record behind', async () => {
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM absence_logs WHERE site_id = $1`, [C]);
    await request(app).post('/api/absence/log').set(bearer(USERS.SM_1)).send(absence(SITES.C, 'T-G-C1'));
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM absence_logs WHERE site_id = $1`, [C]);

    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('late report outside scope -> 403', async () => {
    const res = await request(app).post('/api/late/log').set(bearer(USERS.SM_1)).send({
      epf: 'T-G-C1', officerName: 'Guard', siteId: C, siteName: SITES.C.name, date: '2026-01-15',
      shift: 'Day', scheduledTime: '06:00', actualTime: '06:20', delayMinutes: 20, reason: 'Traffic'
    });
    expect(res.status).toBe(403);
  });

  it('incident outside scope -> 403', async () => {
    const res = await request(app).post('/api/incidents/report').set(bearer(USERS.SM_1)).send({
      category: 'Security', subType: 'Theft', siteId: D, siteName: SITES.D.name, description: 'x'
    });
    expect(res.status).toBe(403);
  });

  it('inspection outside scope -> 403', async () => {
    const res = await request(app).post('/api/inspections/submit').set(bearer(USERS.VO)).send({
      siteId: C, siteName: SITES.C.name, siteRating: 'Good'
    });
    expect(res.status).toBe(403);
  });

  it('check-in at a site outside scope -> 403', async () => {
    const res = await request(app).post('/api/attendance/check-in').set(bearer(USERS.VO)).send({
      epf: USERS.VO.epf, siteId: D, shift: 'Day'
    });
    expect(res.status).toBe(403);
  });

  it('an officer cannot check ANOTHER officer in (identity comes from the token) -> 403', async () => {
    const res = await request(app).post('/api/attendance/check-in').set(bearer(USERS.VO)).send({
      epf: USERS.NVO.epf, siteId: A, shift: 'Day'
    });
    expect(res.status).toBe(403);
  });

  it('submittedBy is taken from the token, ignoring a spoofed value in the body', async () => {
    await request(app).post('/api/absence/log').set(bearer(USERS.SM_1)).send({
      ...absence(SITES.B, 'T-G-B1'), submittedBy: 'EPF-001 (Chamara Waduge)'
    });
    const row = await pool.query(`SELECT submitted_by FROM absence_logs WHERE epf = 'T-G-B1'`);

    expect(row.rows[0].submitted_by).toBe(`${USERS.SM_1.epf} (${USERS.SM_1.name})`);
  });
});
