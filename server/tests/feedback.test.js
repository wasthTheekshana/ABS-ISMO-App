import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';

/** Client feedback after a site visit (SRS FR-16). */

const { VO, SM_1, SM_2, AGM_W, MD, CR, NVO, GUARD, CLIENT } = USERS;
const CLIENT_2 = { epf: 'T-CLIENT-2', name: 'Other Client', role: 'CLIENT', title: 'Client', region: 'Western', sector: 'Sector 01' };

const send = (method, path, user, body) => {
  const r = request(app)[method](path).set(bearer(user));
  return body === undefined ? r : r.send(body);
};

const feedback = (over = {}) => ({
  siteId: SITES.A.id, punctuality: 4, discipline: 5, grooming: 4, communication: 3, overallRating: 4,
  complaints: '', suggestions: 'More night patrols please', ...over
});

const submit = (over, user = CLIENT) => send('post', '/api/feedback', user, feedback(over));

// A completed visit by the VO at site A, made through the real endpoints.
const completedVisit = async () => {
  const at = { lat: SITES.A.lat, lng: SITES.A.lng };
  const arrived = await send('post', '/api/visits/arrive', VO, { siteId: SITES.A.id, ...at });
  await send('post', `/api/visits/${arrived.body.visitId}/depart`, VO, at);
  return arrived.body.visitId;
};

beforeAll(async () => {
  await seedMasterData();
  await pool.query(
    `INSERT INTO users (epf, name, role, title, region, sector, password_hash) VALUES ($1,$2,$3,$4,$5,$6,'x')`,
    [CLIENT_2.epf, CLIENT_2.name, CLIENT_2.role, CLIENT_2.title, CLIENT_2.region, CLIENT_2.sector]
  );
  await pool.query('INSERT INTO client_sites (client_epf, site_id) VALUES ($1, $2)', [CLIENT_2.epf, SITES.A.id]);
});
beforeEach(clearTransactional);
afterAll(closePool);

describe('POST /api/feedback', () => {
  it('records ratings and suggestions without flagging a complaint', async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    expect(res.body.isComplaint).toBe(false);
    const row = (await pool.query('SELECT * FROM client_feedback WHERE feedback_id = $1', [res.body.feedbackId])).rows[0];
    expect(row).toMatchObject({
      site_id: SITES.A.id, client_epf: CLIENT.epf, client_name: CLIENT.name, punctuality: 4, discipline: 5,
      grooming: 4, communication: 3, overall_rating: 4, is_complaint: false, status: 'New'
    });
    expect(row.suggestions).toBe('More night patrols please');
  });

  it('flags feedback with a complaint', async () => {
    const res = await submit({ complaints: 'Guard was asleep at 2am', overallRating: 1 });
    expect(res.body.isComplaint).toBe(true);
    const row = (await pool.query('SELECT is_complaint FROM client_feedback WHERE feedback_id = $1', [res.body.feedbackId])).rows[0];
    expect(row.is_complaint).toBe(true);
  });

  it('treats a whitespace-only complaint as no complaint', async () => {
    expect((await submit({ complaints: '   ' })).body.isComplaint).toBe(false);
  });

  it.each([
    ['punctuality', 0], ['discipline', 6], ['grooming', 3.5], ['communication', '4'], ['overallRating', null], ['overallRating', -1]
  ])('rejects %s = %j with 400', async (field, value) => {
    expect((await submit({ [field]: value })).status).toBe(400);
  });

  it('requires every rating', async () => {
    const { overallRating, ...rest } = feedback();
    expect((await send('post', '/api/feedback', CLIENT, rest)).status).toBe(400);
  });

  it('limits the text length', async () => {
    expect((await submit({ complaints: 'x'.repeat(2001) })).status).toBe(400);
  });

  it('refuses a site that is not linked to the client', async () => {
    expect((await submit({ siteId: SITES.C.id })).status).toBe(403);
  });

  it.each([['SM', SM_1], ['VO', VO], ['MD', MD], ['guard', GUARD], ['CR', CR]])('refuses %s', async (_l, user) => {
    expect((await submit({}, user)).status).toBe(403);
  });

  it('ties feedback to a completed visit at that site, once per client per visit', async () => {
    const visitId = await completedVisit();
    expect((await submit({ visitId })).status).toBe(201);
    const again = await submit({ visitId });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already/i);
    // A different client can still rate the same visit.
    expect((await submit({ visitId }, CLIENT_2)).status).toBe(201);
  });

  it('rejects a visit that was not at the selected site', async () => {
    const visitId = await completedVisit(); // at site A
    await pool.query('INSERT INTO client_sites (client_epf, site_id) VALUES ($1, $2)', [CLIENT.epf, SITES.B.id]);
    const res = await submit({ siteId: SITES.B.id, visitId });
    await pool.query('DELETE FROM client_sites WHERE client_epf = $1 AND site_id = $2', [CLIENT.epf, SITES.B.id]);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown visit', async () => {
    expect((await submit({ visitId: 'VISIT-NOPE' })).status).toBe(400);
  });
});

describe('client helpers: GET /sites and /visits', () => {
  it('lists only the client\'s linked sites', async () => {
    const res = await send('get', '/api/feedback/sites', CLIENT);
    expect(res.body.sites.map((s) => s.siteId)).toEqual([SITES.A.id]);
  });

  it('is refused to staff', async () => {
    expect((await send('get', '/api/feedback/sites', SM_1)).status).toBe(403);
    expect((await send('get', '/api/feedback/visits', SM_1)).status).toBe(403);
  });

  it('lists completed visits at the client\'s sites, without officer EPF or coordinates', async () => {
    const visitId = await completedVisit();
    const res = await send('get', '/api/feedback/visits', CLIENT);
    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
    const v = res.body.visits[0];
    expect(v).toMatchObject({ visitId, siteId: SITES.A.id, officerName: VO.name, hasFeedback: false });
    for (const hidden of ['officerEpf', 'arrivalLat', 'arrivalLng', 'departureLat', 'departureLng']) expect(v).not.toHaveProperty(hidden);
  });

  it('leaves out visits still in progress', async () => {
    await send('post', '/api/visits/arrive', VO, { siteId: SITES.A.id, lat: SITES.A.lat, lng: SITES.A.lng });
    expect((await send('get', '/api/feedback/visits', CLIENT)).body.visits).toEqual([]);
  });

  it('marks a visit once this client has rated it', async () => {
    const visitId = await completedVisit();
    await submit({ visitId });
    expect((await send('get', '/api/feedback/visits', CLIENT)).body.visits[0].hasFeedback).toBe(true);
    expect((await send('get', '/api/feedback/visits', CLIENT_2)).body.visits[0].hasFeedback).toBe(false);
  });

  it('leaves out visits older than 30 days', async () => {
    const visitId = await completedVisit();
    await pool.query(`UPDATE site_visits SET arrived_at = arrived_at - INTERVAL '40 days' WHERE visit_id = $1`, [visitId]);
    expect((await send('get', '/api/feedback/visits', CLIENT)).body.visits).toEqual([]);
  });
});

describe('GET /api/feedback/list', () => {
  it('shows a client only their own submissions', async () => {
    await submit({ suggestions: 'mine' });
    await submit({ suggestions: 'theirs' }, CLIENT_2);
    const res = await send('get', '/api/feedback/list', CLIENT);
    expect(res.body.feedback.map((f) => f.suggestions)).toEqual(['mine']);
  });

  it('shows management the feedback inside their scope', async () => {
    await submit();
    for (const user of [SM_1, AGM_W, MD, CR]) {
      expect((await send('get', '/api/feedback/list', user)).body.feedback).toHaveLength(1);
    }
    expect((await send('get', '/api/feedback/list', SM_2)).body.feedback).toEqual([]);
  });

  it('is not available to field officers or guards', async () => {
    for (const user of [VO, NVO, GUARD]) expect((await send('get', '/api/feedback/list', user)).status).toBe(403);
  });

  it('filters by status and by complaints, and validates the status', async () => {
    await submit();
    await submit({ complaints: 'Late again' }, CLIENT_2);
    const complaintsOnly = (await send('get', '/api/feedback/list?complaints=1', MD)).body.feedback;
    expect(complaintsOnly).toHaveLength(1);
    expect(complaintsOnly[0].isComplaint).toBe(true);
    expect((await send('get', '/api/feedback/list?status=Resolved', MD)).body.feedback).toEqual([]);
    expect((await send('get', '/api/feedback/list?status=New', MD)).body.feedback).toHaveLength(2);
    expect((await send('get', '/api/feedback/list?status=Bogus', MD)).status).toBe(400);
  });

  it('returns newest first with camelCase fields', async () => {
    await submit({ suggestions: 'first' });
    await submit({ suggestions: 'second' }, CLIENT_2);
    const rows = (await send('get', '/api/feedback/list', MD)).body.feedback;
    expect(rows.map((f) => f.suggestions)).toEqual(['second', 'first']);
    expect(rows[0]).toEqual(expect.objectContaining({
      feedbackId: expect.any(String), siteName: SITES.A.name, overallRating: 4, status: 'New', createdAt: expect.any(String)
    }));
  });
});

describe('PATCH /api/feedback/:id/status', () => {
  const create = async (over) => (await submit(over)).body.feedbackId;

  it('acknowledges, then resolves with notes, recording who and when', async () => {
    const id = await create({ complaints: 'Slow response' });
    expect((await send('patch', `/api/feedback/${id}/status`, SM_1, { status: 'Acknowledged' })).status).toBe(200);
    const res = await send('patch', `/api/feedback/${id}/status`, SM_1, { status: 'Resolved', resolutionNotes: 'Guard retrained' });
    expect(res.status).toBe(200);
    const row = (await pool.query('SELECT * FROM client_feedback WHERE feedback_id = $1', [id])).rows[0];
    expect(row).toMatchObject({ status: 'Resolved', resolved_by: `${SM_1.epf} (${SM_1.name})`, resolution_notes: 'Guard retrained' });
    expect(row.resolved_at).not.toBeNull();
  });

  it('shows the client the outcome of their feedback', async () => {
    const id = await create({ complaints: 'Slow response' });
    await send('patch', `/api/feedback/${id}/status`, MD, { status: 'Resolved', resolutionNotes: 'Fixed' });
    const mine = (await send('get', '/api/feedback/list', CLIENT)).body.feedback[0];
    expect(mine).toMatchObject({ status: 'Resolved', resolutionNotes: 'Fixed' });
  });

  it('requires resolution notes to resolve', async () => {
    const id = await create();
    expect((await send('patch', `/api/feedback/${id}/status`, SM_1, { status: 'Resolved' })).status).toBe(400);
    expect((await send('patch', `/api/feedback/${id}/status`, SM_1, { status: 'Resolved', resolutionNotes: '  ' })).status).toBe(400);
  });

  it('can be reopened, clearing the resolution', async () => {
    const id = await create();
    await send('patch', `/api/feedback/${id}/status`, SM_1, { status: 'Resolved', resolutionNotes: 'Done' });
    expect((await send('patch', `/api/feedback/${id}/status`, SM_1, { status: 'New' })).status).toBe(200);
    const row = (await pool.query('SELECT status, resolved_at, resolved_by, resolution_notes FROM client_feedback WHERE feedback_id = $1', [id])).rows[0];
    expect(row).toEqual({ status: 'New', resolved_at: null, resolved_by: null, resolution_notes: null });
  });

  it('rejects an unknown status and a no-op change', async () => {
    const id = await create();
    expect((await send('patch', `/api/feedback/${id}/status`, SM_1, { status: 'Done' })).status).toBe(400);
    expect((await send('patch', `/api/feedback/${id}/status`, SM_1, { status: 'New' })).status).toBe(409);
  });

  it('keeps an SM out of another sector\'s feedback, and 404s unknown IDs', async () => {
    const id = await create();
    expect((await send('patch', `/api/feedback/${id}/status`, SM_2, { status: 'Acknowledged' })).status).toBe(403);
    expect((await send('patch', '/api/feedback/FB-NOPE/status', SM_1, { status: 'Acknowledged' })).status).toBe(404);
  });

  it.each([['client', CLIENT], ['VO', VO], ['NVO', NVO], ['guard', GUARD]])('refuses %s', async (_l, user) => {
    const id = await create();
    expect((await send('patch', `/api/feedback/${id}/status`, user, { status: 'Acknowledged' })).status).toBe(403);
  });
});
