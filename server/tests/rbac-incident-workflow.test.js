import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';

/**
 * SRS FR-20 (Security Guard + Client roles), FR-13 / NFR-5 (incident closure, editing and
 * audit trail) and FR-15 (full inspection checklist).
 */

const { SM_1, SM_2, VO, CR, AGM_W, MD, GUARD, CLIENT } = USERS;

const send = (method, path, user, body) => {
  const r = request(app)[method](path).set(bearer(user));
  return body === undefined ? r : r.send(body);
};

const incidentBody = (over = {}) => ({
  category: 'Security', subType: 'Theft', severity: 'High', siteId: SITES.A.id, siteName: SITES.A.name,
  description: 'Laptop taken from reception', witnessDetails: 'Receptionist saw a man leave',
  clientRepDetails: 'Mr Silva, 0771234567', actionTaken: 'Police called', policeNotified: true,
  estimatedLoss: 150000, gpsLat: 6.9271, gpsLng: 79.8612, ...over
});

const report = async (user = SM_1, over = {}) => {
  const res = await send('post', '/api/incidents/report', user, incidentBody(over));
  expect(res.status).toBe(201);
  return res.body.incidentId;
};

beforeAll(seedMasterData);
beforeEach(clearTransactional);
afterAll(closePool);

describe('Security Guard role (own site only)', () => {
  it('can report an incident at their own site', async () => {
    expect((await send('post', '/api/incidents/report', GUARD, incidentBody())).status).toBe(201);
  });

  it('cannot report at a site they are not posted to', async () => {
    const res = await send('post', '/api/incidents/report', GUARD, incidentBody({ siteId: SITES.C.id, siteName: SITES.C.name }));
    expect(res.status).toBe(403);
  });

  it('sees only the incidents they reported themselves', async () => {
    const mine = await report(GUARD);
    await report(SM_1, { description: 'Reported by the SM' });
    const res = await send('get', '/api/incidents/list', GUARD);
    expect(res.status).toBe(200);
    expect(res.body.incidents.map((i) => i.incidentId)).toEqual([mine]);
  });

  it('sees the site roster, but only the one site they are posted to', async () => {
    const res = await send('get', '/api/sites', GUARD);
    expect(res.status).toBe(200);
    expect(res.body.sites.map((s) => s.siteId)).toEqual([SITES.A.id]);
  });

  it.each(['/api/kpis/executive', '/api/absence/logs', '/api/late/logs', '/api/officers', '/api/inspections/list'])(
    'is refused %s', async (path) => {
      expect((await send('get', path, GUARD)).status).toBe(403);
    }
  );

  it('cannot edit, close or read the audit trail of an incident', async () => {
    const id = await report(GUARD);
    expect((await send('patch', `/api/incidents/${id}`, GUARD, { severity: 'Low' })).status).toBe(403);
    expect((await send('patch', `/api/incidents/${id}/status`, GUARD, { status: 'Closed', closureNotes: 'x' })).status).toBe(403);
    expect((await send('get', `/api/incidents/${id}/audit`, GUARD)).status).toBe(403);
  });
});

describe('Client role (read-only, own sites, redacted)', () => {
  it('sees incidents at their linked site only, without internal detail', async () => {
    await report(SM_1);
    await report(SM_2, { siteId: SITES.C.id, siteName: SITES.C.name });
    const res = await send('get', '/api/incidents/list', CLIENT);
    expect(res.status).toBe(200);
    expect(res.body.incidents).toHaveLength(1);
    const row = res.body.incidents[0];
    expect(row.siteId).toBe(SITES.A.id);
    expect(row.description).toBeTruthy();
    for (const hidden of ['estimatedLoss', 'reportedBy', 'witnessDetails', 'clientRepDetails', 'gpsLat', 'gpsLng', 'photoUrls']) {
      expect(row).not.toHaveProperty(hidden);
    }
  });

  it('sees inspections at their site only', async () => {
    await send('post', '/api/inspections/submit', VO, { siteId: SITES.A.id, siteName: SITES.A.name, siteRating: 'Good' });
    await send('post', '/api/inspections/submit', SM_2, { siteId: SITES.C.id, siteName: SITES.C.name, siteRating: 'Poor' });
    const res = await send('get', '/api/inspections/list', CLIENT);
    expect(res.body.inspections.map((i) => i.siteId)).toEqual([SITES.A.id]);
  });

  it('cannot report incidents or submit inspections', async () => {
    expect((await send('post', '/api/incidents/report', CLIENT, incidentBody())).status).toBe(403);
    expect((await send('post', '/api/inspections/submit', CLIENT, { siteId: SITES.A.id, siteName: 'x', siteRating: 'Good' })).status).toBe(403);
  });

  it.each(['/api/sites', '/api/kpis/executive', '/api/absence/logs', '/api/late/logs', '/api/officers'])(
    'is refused %s', async (path) => {
      expect((await send('get', path, CLIENT)).status).toBe(403);
    }
  );

  it('sees nothing when no site is linked to the account', async () => {
    await pool.query('DELETE FROM client_sites');
    await report(SM_1);
    expect((await send('get', '/api/incidents/list', CLIENT)).body.incidents).toEqual([]);
    await pool.query('INSERT INTO client_sites (client_epf, site_id) VALUES ($1, $2)', [CLIENT.epf, SITES.A.id]);
  });
});

describe('incident closure workflow (FR-13)', () => {
  it('starts open, and Control Room can close it with notes', async () => {
    const id = await report();
    const res = await send('patch', `/api/incidents/${id}/status`, CR, { status: 'Closed', closureNotes: 'Laptop recovered' });
    expect(res.status).toBe(200);
    const row = (await send('get', '/api/incidents/list', CR)).body.incidents.find((i) => i.incidentId === id);
    expect(row).toMatchObject({ status: 'Closed', closureNotes: 'Laptop recovered', closedBy: `${CR.epf} (${CR.name})` });
    expect(row.closedAt).toBeTruthy();
  });

  it('refuses to close without closure notes', async () => {
    const id = await report();
    expect((await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Closed' })).status).toBe(400);
    expect((await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Closed', closureNotes: '   ' })).status).toBe(400);
  });

  it('rejects an unknown status and a no-op change', async () => {
    const id = await report();
    expect((await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Done' })).status).toBe(400);
    expect((await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Open & Investigating' })).status).toBe(409);
  });

  it('can be escalated, then closed, then reopened (closure fields cleared)', async () => {
    const id = await report();
    expect((await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Escalated' })).status).toBe(200);
    await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Closed', closureNotes: 'Resolved' });
    expect((await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Open & Investigating' })).status).toBe(200);
    const row = (await send('get', '/api/incidents/list', SM_1)).body.incidents.find((i) => i.incidentId === id);
    expect(row).toMatchObject({ status: 'Open & Investigating', closedAt: null, closedBy: null, closureNotes: null });
  });

  it('keeps an SM out of incidents at another sector\'s site', async () => {
    const id = await report();
    expect((await send('patch', `/api/incidents/${id}/status`, SM_2, { status: 'Closed', closureNotes: 'x' })).status).toBe(403);
    expect((await send('patch', `/api/incidents/${id}`, SM_2, { severity: 'Low' })).status).toBe(403);
    expect((await send('get', `/api/incidents/${id}/audit`, SM_2)).status).toBe(403);
  });

  it('returns 404 for an unknown incident', async () => {
    expect((await send('patch', '/api/incidents/NOPE/status', SM_1, { status: 'Escalated' })).status).toBe(404);
    expect((await send('patch', '/api/incidents/NOPE', SM_1, { severity: 'Low' })).status).toBe(404);
  });

  it('stores the client representative details on report', async () => {
    const id = await report();
    const row = (await send('get', '/api/incidents/list', SM_1)).body.incidents.find((i) => i.incidentId === id);
    expect(row.clientRepDetails).toBe('Mr Silva, 0771234567');
  });
});

describe('incident editing and audit trail (NFR-5)', () => {
  it('edits fields and records who changed what, oldest first', async () => {
    const id = await report();
    const res = await send('patch', `/api/incidents/${id}`, SM_1, { severity: 'Critical', estimatedLoss: 200000, hospitalNotified: true });
    expect(res.status).toBe(200);
    expect(res.body.changed.sort()).toEqual(['estimatedLoss', 'hospitalNotified', 'severity']);

    const audit = (await send('get', `/api/incidents/${id}/audit`, MD)).body.audit;
    expect(audit).toHaveLength(3);
    const sev = audit.find((a) => a.field === 'severity');
    expect(sev).toMatchObject({ oldValue: 'High', newValue: 'Critical', changedBy: `${SM_1.epf} (${SM_1.name})` });
    expect(audit.find((a) => a.field === 'estimatedLoss')).toMatchObject({ oldValue: '150000', newValue: '200000' });
    expect(audit.find((a) => a.field === 'hospitalNotified')).toMatchObject({ oldValue: 'false', newValue: 'true' });

    const row = (await send('get', '/api/incidents/list', SM_1)).body.incidents.find((i) => i.incidentId === id);
    expect(row.severity).toBe('Critical');
    expect(row.updatedAt).toBeTruthy();
  });

  it('does not log a field that did not actually change', async () => {
    const id = await report();
    const res = await send('patch', `/api/incidents/${id}`, SM_1, { severity: 'High', description: 'Laptop taken from reception' });
    expect(res.body.changed).toEqual([]);
    expect((await send('get', `/api/incidents/${id}/audit`, SM_1)).body.audit).toEqual([]);
  });

  it('refuses edits to a closed incident until it is reopened', async () => {
    const id = await report();
    await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Closed', closureNotes: 'Resolved' });
    expect((await send('patch', `/api/incidents/${id}`, SM_1, { severity: 'Low' })).status).toBe(409);
    await send('patch', `/api/incidents/${id}/status`, SM_1, { status: 'Open & Investigating' });
    expect((await send('patch', `/api/incidents/${id}`, SM_1, { severity: 'Low' })).status).toBe(200);
  });

  it('audits status changes including closure notes', async () => {
    const id = await report();
    await send('patch', `/api/incidents/${id}/status`, CR, { status: 'Closed', closureNotes: 'Resolved on site' });
    const audit = (await send('get', `/api/incidents/${id}/audit`, CR)).body.audit;
    expect(audit.map((a) => a.field)).toEqual(['status', 'closureNotes']);
    expect(audit[0]).toMatchObject({ oldValue: 'Open & Investigating', newValue: 'Closed' });
    expect(audit[1].newValue).toBe('Resolved on site');
  });

  it.each([
    [{ severity: 'Extreme' }], [{ description: '   ' }], [{ estimatedLoss: -5 }], [{ estimatedLoss: 'lots' }], [{}], [{ unknown: 1 }]
  ])('rejects invalid edit %j with 400', async (body) => {
    const id = await report();
    expect((await send('patch', `/api/incidents/${id}`, SM_1, body)).status).toBe(400);
  });

  it('is deleted together with the incident (no orphan audit rows)', async () => {
    const id = await report();
    await send('patch', `/api/incidents/${id}`, SM_1, { severity: 'Low' });
    await pool.query('DELETE FROM incidents WHERE incident_id = $1', [id]);
    const { rows } = await pool.query('SELECT COUNT(*) FROM incident_audit WHERE incident_id = $1', [id]);
    expect(rows[0].count).toBe('0');
  });
});

describe('full site inspection checklist (FR-15)', () => {
  const full = (over = {}) => ({
    siteId: SITES.A.id, siteName: SITES.A.name, siteRating: 'Excellent',
    presenceCheck: true, uniformCheck: true, idCheck: true, groomingCheck: false, registerCheck: true,
    fireEqCheck: true, cctvCheck: true, alarmCheck: true, clientSatisfactionCheck: true,
    cleanlinessCheck: false, equipmentCheck: true, weaponsCheck: true, ...over
  });

  it('stores all twelve checks and returns them', async () => {
    const res = await send('post', '/api/inspections/submit', VO, full());
    expect(res.status).toBe(201);
    const row = (await send('get', '/api/inspections/list', VO)).body.inspections[0];
    expect(row).toMatchObject({
      presenceCheck: true, uniformCheck: true, idCheck: true, groomingCheck: false, registerCheck: true,
      fireEqCheck: true, cctvCheck: true, alarmCheck: true, clientSatisfactionCheck: true,
      cleanlinessCheck: false, equipmentCheck: true, weaponsCheck: true
    });
  });

  it('stores weapons as not-applicable (null), not as failed, when omitted or null', async () => {
    await send('post', '/api/inspections/submit', VO, full({ weaponsCheck: null }));
    const { weaponsCheck } = (await send('get', '/api/inspections/list', VO)).body.inspections[0];
    expect(weaponsCheck).toBeNull();
  });

  it('still accepts the original five-item payload from older apps', async () => {
    const res = await send('post', '/api/inspections/submit', VO, {
      siteId: SITES.A.id, siteName: SITES.A.name, siteRating: 'Good',
      uniformCheck: true, idCheck: true, registerCheck: true, cctvCheck: true, fireEqCheck: true
    });
    expect(res.status).toBe(201);
    const row = (await send('get', '/api/inspections/list', VO)).body.inspections[0];
    expect(row.fireEqCheck).toBe(true);
    for (const k of ['presenceCheck', 'groomingCheck', 'alarmCheck', 'clientSatisfactionCheck', 'cleanlinessCheck', 'equipmentCheck', 'weaponsCheck']) {
      expect(row[k]).toBeNull();
    }
  });

  it('only VO, NVO and SM may perform an inspection', async () => {
    expect((await send('post', '/api/inspections/submit', SM_1, full())).status).toBe(201);
    for (const user of [AGM_W, MD, CR]) {
      expect((await send('post', '/api/inspections/submit', user, full())).status).toBe(403);
    }
  });
});
