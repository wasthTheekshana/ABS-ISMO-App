import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';
import { pathKm, haversineMeters } from '../utils/geo.js';

/** GPS site visits (SRS FR-14) and the live officer map (FR-8). */

const { VO, NVO, SM_1, SM_2, AGM_W, AGM_C, MD, GM, CR, GUARD, CLIENT } = USERS;

const send = (method, path, user, body) => {
  const r = request(app)[method](path).set(bearer(user));
  return body === undefined ? r : r.send(body);
};

const AT_A = { lat: SITES.A.lat, lng: SITES.A.lng };       // exactly on site A
const AT_B = { lat: SITES.B.lat, lng: SITES.B.lng };
const FAR = { lat: 6.9520, lng: 79.9930 };                    // ~15 km from site A

const arrive = (user = VO, siteId = SITES.A.id, point = AT_A) => send('post', '/api/visits/arrive', user, { siteId, ...point });
const depart = (id, user = VO, point) => send('post', `/api/visits/${id}/depart`, user, point);

beforeAll(seedMasterData);
beforeEach(clearTransactional);
afterAll(closePool);

describe('POST /api/visits/arrive', () => {
  it('records an on-site arrival with the geofence result and a first ping', async () => {
    const res = await arrive();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ onSite: true, travelKm: 0 });
    expect(res.body.distanceFromSiteM).toBeLessThanOrEqual(5);

    const visit = (await pool.query('SELECT * FROM site_visits WHERE visit_id = $1', [res.body.visitId])).rows[0];
    expect(visit).toMatchObject({ officer_epf: VO.epf, officer_name: VO.name, officer_role: 'VO', site_name: SITES.A.name, on_site: true });
    expect(visit.departed_at).toBeNull();
    const pings = await pool.query('SELECT * FROM location_pings WHERE visit_id = $1', [res.body.visitId]);
    expect(pings.rows).toHaveLength(1);
  });

  it('flags an arrival away from the site but still records it', async () => {
    const res = await arrive(VO, SITES.A.id, FAR);
    expect(res.status).toBe(201);
    expect(res.body.onSite).toBe(false);
    expect(res.body.distanceFromSiteM).toBeGreaterThan(10000);
    expect(res.body.message).toMatch(/away from the site/i);
  });

  it('leaves the geofence result empty when the site has no coordinates', async () => {
    await pool.query('UPDATE sites SET lat = NULL, lng = NULL WHERE site_id = $1', [SITES.B.id]);
    const res = await arrive(VO, SITES.B.id, AT_B);
    expect(res.status).toBe(201);
    expect(res.body.onSite).toBeNull();
    expect(res.body.distanceFromSiteM).toBeNull();
    await pool.query('UPDATE sites SET lat = $2, lng = $3 WHERE site_id = $1', [SITES.B.id, SITES.B.lat, SITES.B.lng]);
  });

  it('lets a night visiting officer arrive too', async () => {
    expect((await arrive(NVO)).status).toBe(201);
  });

  it.each([['SM', SM_1], ['MD', MD], ['guard', GUARD], ['client', CLIENT]])('refuses %s', async (_l, user) => {
    expect((await arrive(user)).status).toBe(403);
  });

  it('refuses a site outside the officer\'s scope', async () => {
    expect((await arrive(VO, SITES.C.id)).status).toBe(403);
  });

  it.each([
    [{ lat: 91, lng: 79 }], [{ lat: 6.9, lng: 181 }], [{ lat: 'north', lng: 79 }], [{ lat: 6.9 }], [{ lng: 79.8 }]
  ])('rejects bad coordinates %j with 400', async (point) => {
    expect((await send('post', '/api/visits/arrive', VO, { siteId: SITES.A.id, ...point })).status).toBe(400);
  });

  it('refuses a second arrival while a visit is open, returning the open one', async () => {
    const first = await arrive();
    const second = await arrive(VO, SITES.B.id, AT_B);
    expect(second.status).toBe(409);
    expect(second.body.existingRecord.visitId).toBe(first.body.visitId);
  });

  it('only one of two simultaneous arrivals opens a visit', async () => {
    const [a, b] = await Promise.all([arrive(), arrive()]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});

describe('POST /api/visits/:id/depart', () => {
  it('ends the visit, stores the departure fix and the duration', async () => {
    const { visitId } = (await arrive()).body;
    const res = await depart(visitId, VO, AT_B);
    expect(res.status).toBe(200);
    expect(res.body.durationMinutes).toBeGreaterThanOrEqual(0);
    const v = (await pool.query('SELECT * FROM site_visits WHERE visit_id = $1', [visitId])).rows[0];
    expect(v.departed_at).not.toBeNull();
    expect(Number(v.departure_lat)).toBeCloseTo(AT_B.lat, 5);
  });

  it('accepts a departure without a location fix', async () => {
    const { visitId } = (await arrive()).body;
    expect((await depart(visitId)).status).toBe(200);
  });

  it('refuses to end a visit twice', async () => {
    const { visitId } = (await arrive()).body;
    await depart(visitId);
    expect((await depart(visitId)).status).toBe(409);
  });

  it('cannot end another officer\'s visit (404, still open)', async () => {
    const { visitId } = (await arrive()).body;
    expect((await depart(visitId, NVO)).status).toBe(404);
    const v = (await pool.query('SELECT departed_at FROM site_visits WHERE visit_id = $1', [visitId])).rows[0];
    expect(v.departed_at).toBeNull();
  });

  it('returns 404 for an unknown visit and 400 for a bad location', async () => {
    expect((await depart('VISIT-NOPE')).status).toBe(404);
    const { visitId } = (await arrive()).body;
    expect((await depart(visitId, VO, { lat: 200, lng: 10 })).status).toBe(400);
  });

  it('allows a new arrival after departing', async () => {
    const { visitId } = (await arrive()).body;
    await depart(visitId);
    expect((await arrive(VO, SITES.B.id, AT_B)).status).toBe(201);
  });

  it('refuses non-visiting roles', async () => {
    const { visitId } = (await arrive()).body;
    expect((await depart(visitId, SM_1)).status).toBe(403);
  });
});

describe('travel distance since the previous visit today (FR-14)', () => {
  it('is the breadcrumb path from the last departure through the pings to the new arrival', async () => {
    const first = (await arrive(VO, SITES.A.id, AT_A)).body;
    await depart(first.visitId, VO, AT_A);
    const midway = { lat: 6.9230, lng: 79.8470 };
    expect((await send('post', '/api/visits/ping', VO, midway)).status).toBe(201);
    const second = await arrive(VO, SITES.B.id, AT_B);

    const expected = pathKm([AT_A, midway, AT_B]);
    expect(second.body.travelKm).toBeCloseTo(expected, 1);
    const direct = haversineMeters(AT_A, AT_B) / 1000;
    expect(second.body.travelKm).toBeGreaterThanOrEqual(Number(direct.toFixed(2)) - 0.01);
  });

  it('is zero for the first visit of the day', async () => {
    expect((await arrive()).body.travelKm).toBe(0);
  });
});

describe('POST /api/visits/ping', () => {
  it('attaches the ping to the open visit', async () => {
    const { visitId } = (await arrive()).body;
    const res = await send('post', '/api/visits/ping', VO, { ...AT_A, accuracy: 12.4 });
    expect(res.status).toBe(201);
    expect(res.body.visitId).toBe(visitId);
    const row = (await pool.query('SELECT accuracy_m FROM location_pings WHERE visit_id = $1 ORDER BY id DESC LIMIT 1', [visitId])).rows[0];
    expect(row.accuracy_m).toBe(12);
  });

  it('records a ping between visits with no visit attached', async () => {
    const res = await send('post', '/api/visits/ping', NVO, AT_B);
    expect(res.status).toBe(201);
    expect(res.body.visitId).toBeNull();
  });

  it.each([[{ lat: 95, lng: 10 }], [{ lat: 6.9, lng: 79.8, accuracy: -3 }], [{ lat: 6.9 }]])('rejects %j with 400', async (body) => {
    expect((await send('post', '/api/visits/ping', VO, body)).status).toBe(400);
  });

  it.each([['SM', SM_1], ['guard', GUARD], ['CR', CR]])('refuses %s', async (_l, user) => {
    expect((await send('post', '/api/visits/ping', user, AT_A)).status).toBe(403);
  });
});

describe('GET /api/visits/mine and /list', () => {
  it('shows the open visit and today\'s visits to the officer', async () => {
    const first = (await arrive()).body;
    await depart(first.visitId);
    const second = (await arrive(VO, SITES.B.id, AT_B)).body;
    const res = await send('get', '/api/visits/mine', VO);
    expect(res.status).toBe(200);
    expect(res.body.open.visitId).toBe(second.visitId);
    expect(res.body.today.map((v) => v.visitId)).toEqual([second.visitId, first.visitId]);
  });

  it('has no open visit before arriving', async () => {
    const res = await send('get', '/api/visits/mine', NVO);
    expect(res.body.open).toBeNull();
    expect(res.body.today).toEqual([]);
  });

  it('lists visits within the caller\'s scope only', async () => {
    const { visitId } = (await arrive()).body;
    expect((await send('get', '/api/visits/list', SM_1)).body.visits.map((v) => v.visitId)).toEqual([visitId]);
    expect((await send('get', '/api/visits/list', SM_2)).body.visits).toEqual([]);
    expect((await send('get', '/api/visits/list', AGM_C)).body.visits).toEqual([]);
  });

  it('shows raw coordinates to MD and GM only', async () => {
    await arrive();
    const md = (await send('get', '/api/visits/list', MD)).body.visits[0];
    expect(md.arrivalLat).toBeCloseTo(AT_A.lat, 5);
    for (const user of [SM_1, AGM_W, CR]) {
      const v = (await send('get', '/api/visits/list', user)).body.visits[0];
      expect(v).not.toHaveProperty('arrivalLat');
      expect(v).not.toHaveProperty('departureLng');
    }
  });

  it('filters by date and validates it', async () => {
    const { visitId } = (await arrive()).body;
    await pool.query(`UPDATE site_visits SET arrived_at = arrived_at - INTERVAL '3 days' WHERE visit_id = $1`, [visitId]);
    expect((await send('get', '/api/visits/list', MD)).body.visits).toEqual([]);
    const old = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date(Date.now() - 3 * 86400000));
    expect((await send('get', `/api/visits/list?date=${old}`, MD)).body.visits).toHaveLength(1);
    expect((await send('get', '/api/visits/list?date=2026-02-31', MD)).status).toBe(400);
    expect((await send('get', '/api/visits/list?date=yesterday', MD)).status).toBe(400);
  });

  it('is a staff-only list: guards and clients are refused', async () => {
    expect((await send('get', '/api/visits/list', GUARD)).status).toBe(403);
    expect((await send('get', '/api/visits/list', CLIENT)).status).toBe(403);
  });
});

// Regression: an officer who forgot to depart used to be blocked from every new visit, indefinitely.
describe('abandoned visits', () => {
  const openVisit = async (hoursAgo, pingHoursAgo) => {
    await pool.query(
      `INSERT INTO site_visits (visit_id, officer_epf, officer_name, officer_role, site_id, site_name, arrived_at)
       VALUES ('VISIT-STALE', $1, $2, 'VO', $3, $4, CURRENT_TIMESTAMP - ($5 || ' hours')::interval)`,
      [VO.epf, VO.name, SITES.A.id, SITES.A.name, hoursAgo]
    );
    if (pingHoursAgo !== undefined) {
      await pool.query(
        `INSERT INTO location_pings (officer_epf, visit_id, lat, lng, recorded_at)
         VALUES ($1, 'VISIT-STALE', $2, $3, CURRENT_TIMESTAMP - ($4 || ' hours')::interval)`,
        [VO.epf, SITES.A.lat, SITES.A.lng, pingHoursAgo]
      );
    }
  };

  it('closes a visit left open for over 16 hours when the officer arrives somewhere new', async () => {
    await openVisit(20, 18); // last seen 18 hours ago, i.e. 2 hours into the visit

    const res = await arrive(VO, SITES.B.id, AT_B);
    expect(res.status).toBe(201);

    const old = (await pool.query(`SELECT departed_at, arrived_at, duration_minutes, notes FROM site_visits WHERE visit_id = 'VISIT-STALE'`)).rows[0];
    expect(old.departed_at).not.toBeNull();
    expect(old.duration_minutes).toBe(120); // ended at the last location fix, not at "now"
    expect(old.notes).toMatch(/Auto-closed/);
  });

  it('ends a visit with no pings at its arrival time (zero minutes)', async () => {
    await openVisit(30);
    expect((await arrive(VO, SITES.B.id, AT_B)).status).toBe(201);
    const old = (await pool.query(`SELECT duration_minutes FROM site_visits WHERE visit_id = 'VISIT-STALE'`)).rows[0];
    expect(old.duration_minutes).toBe(0);
  });

  it("no longer shows an abandoned visit as the officer's open visit", async () => {
    await openVisit(20, 19);
    const mine = await send('get', '/api/visits/mine', VO);
    expect(mine.status).toBe(200);
    expect(mine.body.open).toBeNull();
  });

  it('still blocks a second arrival while a recent visit is open', async () => {
    await openVisit(2, 1);
    const res = await arrive(VO, SITES.B.id, AT_B);
    expect(res.status).toBe(409);
    expect(res.body.existingRecord.visitId).toBe('VISIT-STALE');
  });
});

describe('GET /api/visits/live (FR-8)', () => {
  const openBoth = async () => {
    await arrive(VO);
    await arrive(NVO);
  };

  it('shows VO and NVO positions to MD and GM', async () => {
    await openBoth();
    for (const user of [MD, GM]) {
      const res = await send('get', '/api/visits/live', user);
      expect(res.status).toBe(200);
      expect(res.body.officers.map((o) => o.role).sort()).toEqual(['NVO', 'VO']);
    }
  });

  it('hides NVO positions from AGM, SM and Control Room', async () => {
    await openBoth();
    for (const user of [AGM_W, SM_1, CR]) {
      const res = await send('get', '/api/visits/live', user);
      expect(res.status).toBe(200);
      expect(res.body.officers.map((o) => o.role)).toEqual(['VO']);
    }
  });

  // Regression: an officer is visible by their own sector/region, but the SITE they are visiting is only
  // revealed to people who can see that site.
  it("does not reveal a visited site outside the viewer's scope", async () => {
    await send('post', '/api/visits/ping', VO, AT_A); // a recent fix so the VO is on the map
    await pool.query(
      `INSERT INTO site_visits (visit_id, officer_epf, officer_name, officer_role, site_id, site_name, arrival_lat, arrival_lng)
       VALUES ('VISIT-OUT-OF-SCOPE', $1, $2, 'VO', $3, $4, $5, $6)`,
      [VO.epf, VO.name, SITES.C.id, SITES.C.name, SITES.C.lat, SITES.C.lng]
    );

    // SM One (Sector 01) sees the VO, but site C is in Sector 02.
    const sm = (await send('get', '/api/visits/live', SM_1)).body.officers;
    expect(sm).toHaveLength(1);
    expect(sm[0]).toMatchObject({ epf: VO.epf, siteId: null, siteName: null, visitId: null });
    expect(JSON.stringify(sm)).not.toContain(SITES.C.name);

    // MD can see every site, so the visit is still shown to them.
    const md = (await send('get', '/api/visits/live', MD)).body.officers;
    expect(md[0]).toMatchObject({ siteId: SITES.C.id, siteName: SITES.C.name, visitId: 'VISIT-OUT-OF-SCOPE' });
  });

  it('limits an AGM to their region and an SM to their sector', async () => {
    await openBoth();
    expect((await send('get', '/api/visits/live', AGM_C)).body.officers).toEqual([]);
    expect((await send('get', '/api/visits/live', SM_2)).body.officers).toEqual([]);
    expect((await send('get', '/api/visits/live', SM_1)).body.officers).toHaveLength(1);
  });

  it('returns the latest position and the current site for each officer', async () => {
    await arrive(VO);
    await send('post', '/api/visits/ping', VO, AT_B);
    const res = await send('get', '/api/visits/live', MD);
    expect(res.body.officers).toHaveLength(1);
    expect(res.body.officers[0]).toMatchObject({ epf: VO.epf, siteId: SITES.A.id, siteName: SITES.A.name });
    expect(res.body.officers[0].lat).toBeCloseTo(AT_B.lat, 5);
    expect(res.body.officers[0].ageSeconds).toBeGreaterThanOrEqual(0);
  });

  it('drops officers whose last fix is older than the window', async () => {
    await arrive(VO);
    await pool.query(`UPDATE location_pings SET recorded_at = recorded_at - INTERVAL '2 hours'`);
    expect((await send('get', '/api/visits/live', MD)).body.officers).toEqual([]);
    expect((await send('get', '/api/visits/live?minutes=180', MD)).body.officers).toHaveLength(1);
  });

  it('has no current site once the officer has departed', async () => {
    const { visitId } = (await arrive(VO)).body;
    await depart(visitId, VO, AT_B);
    const o = (await send('get', '/api/visits/live', MD)).body.officers[0];
    expect(o.siteId).toBeNull();
  });

  it('includes site markers inside the caller\'s scope', async () => {
    const md = (await send('get', '/api/visits/live', MD)).body.sites.map((s) => s.siteId).sort();
    expect(md).toEqual([SITES.A.id, SITES.B.id, SITES.C.id, SITES.D.id].sort());
    const agm = (await send('get', '/api/visits/live', AGM_W)).body.sites.map((s) => s.siteId);
    expect(agm).not.toContain(SITES.D.id);
    expect((await send('get', '/api/visits/live', MD)).body.sites[0].lat).toEqual(expect.any(Number));
  });

  it.each(['0', '-5', '1.5', 'abc', '99999'])('rejects minutes=%s with 400', async (m) => {
    expect((await send('get', `/api/visits/live?minutes=${m}`, MD)).status).toBe(400);
  });

  it.each([['VO', VO], ['NVO', NVO], ['guard', GUARD], ['client', CLIENT]])('refuses %s', async (_l, user) => {
    expect((await send('get', '/api/visits/live', user)).status).toBe(403);
  });
});
