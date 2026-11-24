import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';

/** Future-phase modules: incident reporting (FR-9..13) and digital site inspections (FR-15). */

const SM = USERS.SM_1;
const MD = USERS.MD;

const incident = (over = {}) => ({
  category: 'Security', subType: 'Theft', siteId: SITES.A.id, siteName: SITES.A.name,
  description: 'Laptop stolen from reception', ...over
});

const inspection = (over = {}) => ({
  siteId: SITES.A.id, siteName: SITES.A.name, siteRating: 'Good',
  uniformCheck: true, idCheck: true, registerCheck: false, cctvCheck: true, fireEqCheck: true, ...over
});

const postIncident = (body, user = SM) => request(app).post('/api/incidents/report').set(bearer(user)).send(body);
const postInspection = (body, user = SM) => request(app).post('/api/inspections/submit').set(bearer(user)).send(body);

beforeAll(seedMasterData);
beforeEach(clearTransactional);
afterAll(closePool);

describe('POST /api/incidents/report', () => {
  it('records an incident with sensible defaults', async () => {
    const res = await postIncident(incident());

    expect(res.status).toBe(201);
    expect(res.body.incidentId).toMatch(/^INC-SEC-\d{8}-[0-9A-F]{6}$/);

    const row = (await pool.query(`SELECT * FROM incidents WHERE incident_id = $1`, [res.body.incidentId])).rows[0];
    expect(row).toMatchObject({
      category: 'Security', sub_type: 'Theft', severity: 'Medium', site_id: SITES.A.id,
      status: 'Open & Investigating', police_notified: false, hospital_notified: false, fire_notified: false,
      reported_by: `${SM.epf} (${SM.name})`
    });
    expect(Number(row.estimated_loss)).toBe(0);
    expect(row.photo_urls).toEqual([]);
  });

  it('stores the full optional detail set', async () => {
    const res = await postIncident(incident({
      category: 'Medical', subType: 'Injury', severity: 'Critical', gpsLat: 6.9271, gpsLng: 79.8612,
      photoUrls: ['a.jpg', 'b.jpg'], witnessDetails: 'Two staff', actionTaken: 'First aid',
      policeNotified: true, hospitalNotified: true, fireNotified: false, estimatedLoss: '1250.50'
    }));
    const row = (await pool.query(`SELECT * FROM incidents WHERE incident_id = $1`, [res.body.incidentId])).rows[0];

    expect(row).toMatchObject({ severity: 'Critical', police_notified: true, hospital_notified: true, witness_details: 'Two staff' });
    expect(Number(row.estimated_loss)).toBe(1250.5);
    expect(Number(row.gps_lat)).toBeCloseTo(6.9271, 4);
    expect(row.photo_urls).toEqual(['a.jpg', 'b.jpg']);
  });

  it('attributes the report to the authenticated user, ignoring a spoofed reportedBy', async () => {
    const res = await postIncident(incident({ reportedBy: 'EPF-001 (Chamara Waduge)' }));
    const row = (await pool.query(`SELECT reported_by FROM incidents WHERE incident_id = $1`, [res.body.incidentId])).rows[0];

    expect(row.reported_by).toBe(`${SM.epf} (${SM.name})`);
  });

  it.each(['category', 'subType', 'siteId', 'siteName', 'description'])('returns 400 when "%s" is missing', async (field) => {
    const body = incident();
    delete body[field];
    const res = await postIncident(body);

    expect(res.status).toBe(400);
    expect(res.body.missingFields).toContain(field);
  });

  it('rejects an unknown category', async () => {
    expect((await postIncident(incident({ category: 'Alien Invasion' }))).status).toBe(400);
  });

  it('rejects an unknown severity', async () => {
    expect((await postIncident(incident({ severity: 'banana' }))).status).toBe(400);
  });

  it.each([[91, 0], [-91, 0], [0, 181], [0, -181], ['north', 0]])('rejects out-of-range GPS (%s, %s)', async (gpsLat, gpsLng) => {
    expect((await postIncident(incident({ gpsLat, gpsLng }))).status).toBe(400);
  });

  it('rejects a negative estimated loss', async () => {
    expect((await postIncident(incident({ estimatedLoss: -5 }))).status).toBe(400);
  });

  it('does not store anything when validation fails', async () => {
    await postIncident(incident({ severity: 'banana' }));

    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM incidents`)).rows[0].n).toBe(0);
  });

  it('rejects a report for a site that does not exist', async () => {
    const res = await postIncident(incident({ siteId: 'NO-SUCH-SITE' }), MD);

    expect(res.status).toBe(403);
  });

  it('treats script/SQL content in the description as inert text', async () => {
    const nasty = `<script>alert(1)</script>'; DELETE FROM incidents; --`;
    const res = await postIncident(incident({ description: nasty }));
    const row = (await pool.query(`SELECT description FROM incidents WHERE incident_id = $1`, [res.body.incidentId])).rows[0];

    expect(res.status).toBe(201);
    expect(row.description).toBe(nasty);
  });
});

describe('GET /api/incidents/list', () => {
  beforeEach(async () => {
    await postIncident(incident({ category: 'Security', siteId: SITES.A.id, siteName: SITES.A.name }));
    await postIncident(incident({ category: 'Safety', subType: 'Fire', siteId: SITES.A.id, siteName: SITES.A.name }));
    await postIncident(incident({ category: 'Security', siteId: SITES.C.id, siteName: SITES.C.name }), MD);
  });

  it('lists all incidents in scope, newest first', async () => {
    const res = await request(app).get('/api/incidents/list').set(bearer(MD));

    expect(res.body.incidents).toHaveLength(3);
    const times = res.body.incidents.map((i) => new Date(i.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters by category', async () => {
    const res = await request(app).get('/api/incidents/list').query({ category: 'Safety' }).set(bearer(MD));

    expect(res.body.incidents).toHaveLength(1);
    expect(res.body.incidents[0]).toMatchObject({ category: 'Safety', subType: 'Fire' });
  });

  it('filters by site', async () => {
    const res = await request(app).get('/api/incidents/list').query({ siteId: SITES.C.id }).set(bearer(MD));

    expect(res.body.incidents.map((i) => i.siteId)).toEqual([SITES.C.id]);
  });

  it('combines category and site filters', async () => {
    const res = await request(app).get('/api/incidents/list')
      .query({ category: 'Security', siteId: SITES.A.id }).set(bearer(MD));

    expect(res.body.incidents).toHaveLength(1);
  });

  it('treats a SQL-injection attempt in a filter as a plain (non-matching) value', async () => {
    const res = await request(app).get('/api/incidents/list')
      .query({ category: `Security' OR '1'='1` }).set(bearer(MD));

    expect(res.status).toBe(200);
    expect(res.body.incidents).toEqual([]);
  });

  it('exposes camelCase fields the mobile app relies on', async () => {
    const res = await request(app).get('/api/incidents/list').set(bearer(MD));

    expect(res.body.incidents[0]).toEqual(expect.objectContaining({
      incidentId: expect.any(String), subType: expect.any(String), siteName: expect.any(String),
      policeNotified: expect.any(Boolean), reportedBy: expect.any(String), createdAt: expect.anything()
    }));
  });
});

describe('POST /api/inspections/submit', () => {
  it('records an inspection and returns its ID', async () => {
    const res = await postInspection(inspection());

    expect(res.status).toBe(201);
    expect(res.body.inspectionId).toMatch(/^INSP-\d{8}-[0-9A-F]{6}$/);

    const row = (await pool.query(`SELECT * FROM site_inspections WHERE inspection_id = $1`, [res.body.inspectionId])).rows[0];
    expect(row).toMatchObject({
      site_id: SITES.A.id, site_rating: 'Good', uniform_check: true, register_check: false,
      inspector_epf: SM.epf, inspector_name: SM.name
    });
  });

  it('takes the inspector from the token, ignoring spoofed values', async () => {
    const res = await postInspection(inspection({ inspectorEpf: 'EPF-001', inspectorName: 'Chamara Waduge' }));
    const row = (await pool.query(`SELECT inspector_epf, inspector_name FROM site_inspections WHERE inspection_id = $1`, [res.body.inspectionId])).rows[0];

    expect(row).toEqual({ inspector_epf: SM.epf, inspector_name: SM.name });
  });

  it.each(['siteId', 'siteName', 'siteRating'])('returns 400 when "%s" is missing', async (field) => {
    const body = inspection();
    delete body[field];

    expect((await postInspection(body)).status).toBe(400);
  });

  it.each(['Excellent', 'Good', 'Average', 'Poor'])('accepts rating %s', async (rating) => {
    expect((await postInspection(inspection({ siteRating: rating }))).status).toBe(201);
  });

  it('rejects an unknown rating', async () => {
    expect((await postInspection(inspection({ siteRating: 'Amazing' }))).status).toBe(400);
  });
});

describe('GET /api/inspections/list', () => {
  it('lists inspections in scope and filters by site', async () => {
    await postInspection(inspection({ siteId: SITES.A.id, siteName: SITES.A.name }));
    await postInspection(inspection({ siteId: SITES.B.id, siteName: SITES.B.name }));

    const all = await request(app).get('/api/inspections/list').set(bearer(SM));
    const onlyB = await request(app).get('/api/inspections/list').query({ siteId: SITES.B.id }).set(bearer(SM));

    expect(all.body.inspections).toHaveLength(2);
    expect(onlyB.body.inspections.map((i) => i.siteId)).toEqual([SITES.B.id]);
    expect(onlyB.body.inspections[0]).toEqual(expect.objectContaining({
      inspectorName: SM.name, siteRating: 'Good', registerCheck: false, uniformCheck: true
    }));
  });
});
