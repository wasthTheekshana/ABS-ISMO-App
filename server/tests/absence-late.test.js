import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';

/** UC-2 (SRS FR-4, FR-5, S3-03): guard absence + late reporting, incl. duplicate prevention. */

const SM = USERS.SM_1;

const absence = (over = {}) => ({
  epf: 'T-G-A1', officerName: 'Guard A1', siteId: SITES.A.id, siteName: SITES.A.name,
  date: '2026-03-10', shift: 'Day', reason: 'Sick leave', ...over
});

const late = (over = {}) => ({
  epf: 'T-G-A1', officerName: 'Guard A1', siteId: SITES.A.id, siteName: SITES.A.name,
  date: '2026-03-10', shift: 'Day', scheduledTime: '06:00', actualTime: '06:40',
  delayMinutes: 40, reason: 'Bus breakdown', ...over
});

const post = (path, body, user = SM) => request(app).post(path).set(bearer(user)).send(body);

beforeAll(seedMasterData);
beforeEach(clearTransactional);
afterAll(closePool);

describe('POST /api/absence/log', () => {
  it('records an absence and returns its ID', async () => {
    const res = await post('/api/absence/log', absence());

    expect(res.status).toBe(201);
    expect(res.body.logId).toMatch(/^ABS-LOG-\d{8}-[0-9A-F]{6}$/);

    const row = (await pool.query(`SELECT * FROM absence_logs WHERE log_id = $1`, [res.body.logId])).rows[0];
    expect(row).toMatchObject({
      epf: 'T-G-A1', site_id: SITES.A.id, shift: 'Day', reason: 'Sick leave',
      replacement_deployed: false, replacement_epf: 'N/A', status: 'Logged & Verified'
    });
  });

  it('stamps the submitter from the authenticated user', async () => {
    const res = await post('/api/absence/log', absence());
    const row = (await pool.query(`SELECT submitted_by, timestamp FROM absence_logs WHERE log_id = $1`, [res.body.logId])).rows[0];

    expect(row.submitted_by).toBe(`${SM.epf} (${SM.name})`);
    expect(row.timestamp).toBeInstanceOf(Date);
  });

  it.each(['epf', 'officerName', 'siteId', 'siteName', 'date', 'shift', 'reason'])(
    'returns 400 naming "%s" when it is missing',
    async (field) => {
      const body = absence();
      delete body[field];
      const res = await post('/api/absence/log', body);

      expect(res.status).toBe(400);
      expect(res.body.missingFields).toContain(field);
    }
  );

  it('returns 400 for an empty-string required field', async () => {
    expect((await post('/api/absence/log', absence({ reason: '' }))).status).toBe(400);
  });

  it('marks the site as short-staffed when no replacement was deployed', async () => {
    await post('/api/absence/log', absence({ replacementDeployed: false }));
    const site = (await pool.query(`SELECT current_on_duty, status FROM sites WHERE site_id = $1`, [SITES.A.id])).rows[0];

    expect(site.current_on_duty).toBe(SITES.A.onDuty - 1);
    expect(site.status).toBe('Alert');
  });

  it('leaves the site headcount alone when a replacement WAS deployed', async () => {
    await pool.query(`UPDATE sites SET current_on_duty = $2, status = 'Optimal' WHERE site_id = $1`, [SITES.B.id, SITES.B.onDuty]);
    await post('/api/absence/log', absence({
      epf: 'T-G-B1', siteId: SITES.B.id, siteName: SITES.B.name, replacementDeployed: true, replacementEpf: 'T-G-A2'
    }));
    const site = (await pool.query(`SELECT current_on_duty, status FROM sites WHERE site_id = $1`, [SITES.B.id])).rows[0];

    expect(site.current_on_duty).toBe(SITES.B.onDuty);
    expect(site.status).toBe('Optimal');
  });

  it('never drops current_on_duty below zero', async () => {
    await pool.query(`UPDATE sites SET current_on_duty = 0 WHERE site_id = $1`, [SITES.A.id]);
    await post('/api/absence/log', absence());
    const site = (await pool.query(`SELECT current_on_duty FROM sites WHERE site_id = $1`, [SITES.A.id])).rows[0];

    expect(site.current_on_duty).toBe(0);
  });

  it('stores quotes, semicolons and SQL keywords as plain text (parameterised queries)', async () => {
    const nasty = `x'); DROP TABLE absence_logs; --`;
    const res = await post('/api/absence/log', absence({ reason: nasty, notes: nasty }));

    expect(res.status).toBe(201);
    const row = (await pool.query(`SELECT reason FROM absence_logs WHERE log_id = $1`, [res.body.logId])).rows[0];
    expect(row.reason).toBe(nasty);
  });

  it('generates distinct IDs for many records created in quick succession', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        post('/api/absence/log', absence({ date: `2026-04-${String(i + 1).padStart(2, '0')}` }))
      )
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.logId)).size).toBe(25);
  });
});

describe('absence duplicate prevention (S3-03)', () => {
  it('returns 409 with the existing record when the same officer/date/shift is logged again', async () => {
    const first = await post('/api/absence/log', absence({ reason: 'First entry' }));
    const second = await post('/api/absence/log', absence({ reason: 'Second entry' }));

    expect(second.status).toBe(409);
    expect(second.body.existingRecord).toMatchObject({
      logId: first.body.logId, epf: 'T-G-A1', shift: 'Day', reason: 'First entry'
    });
  });

  it('does not store the duplicate or touch the site headcount a second time', async () => {
    await post('/api/absence/log', absence());
    await post('/api/absence/log', absence());

    const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM absence_logs`)).rows[0].n;
    const site = (await pool.query(`SELECT current_on_duty FROM sites WHERE site_id = $1`, [SITES.A.id])).rows[0];

    expect(count).toBe(1);
    expect(site.current_on_duty).toBe(SITES.A.onDuty - 1);
  });

  it('allows the same officer on a different shift', async () => {
    await post('/api/absence/log', absence({ shift: 'Day' }));
    expect((await post('/api/absence/log', absence({ shift: 'Night' }))).status).toBe(201);
  });

  it('allows the same officer on a different date', async () => {
    await post('/api/absence/log', absence({ date: '2026-03-10' }));
    expect((await post('/api/absence/log', absence({ date: '2026-03-11' }))).status).toBe(201);
  });

  it('allows a different officer on the same date and shift', async () => {
    await post('/api/absence/log', absence({ epf: 'T-G-A1' }));
    expect((await post('/api/absence/log', absence({ epf: 'T-G-A2', officerName: 'Guard A2' }))).status).toBe(201);
  });

  it('exactly one of two simultaneous identical submissions wins; the other gets a 409 with the winner', async () => {
    const [r1, r2] = await Promise.all([
      post('/api/absence/log', absence()),
      post('/api/absence/log', absence())
    ]);
    const statuses = [r1.status, r2.status].sort();

    expect(statuses).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    const winner = r1.status === 201 ? r1 : r2;
    expect(loser.body.existingRecord.logId).toBe(winner.body.logId);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM absence_logs`)).rows[0].n).toBe(1);
  });
});

describe('POST /api/late/log', () => {
  it('records a late arrival and returns its ID', async () => {
    const res = await post('/api/late/log', late());

    expect(res.status).toBe(201);
    expect(res.body.logId).toMatch(/^LATE-LOG-\d{8}-[0-9A-F]{6}$/);

    const row = (await pool.query(`SELECT * FROM late_logs WHERE log_id = $1`, [res.body.logId])).rows[0];
    expect(row).toMatchObject({
      epf: 'T-G-A1', site_id: SITES.A.id, delay_minutes: 40, reason: 'Bus breakdown',
      submitted_by: `${SM.epf} (${SM.name})`
    });
  });

  it.each(['epf', 'officerName', 'siteId', 'siteName', 'date', 'shift', 'scheduledTime', 'actualTime', 'reason'])(
    'returns 400 naming "%s" when it is missing',
    async (field) => {
      const body = late();
      delete body[field];
      const res = await post('/api/late/log', body);

      expect(res.status).toBe(400);
      expect(res.body.missingFields).toContain(field);
    }
  );

  it('derives the delay from the scheduled and actual times when delayMinutes is omitted', async () => {
    const body = late({ scheduledTime: '06:00', actualTime: '06:45' });
    delete body.delayMinutes;
    const res = await post('/api/late/log', body);

    expect(res.status).toBe(201);
    const row = (await pool.query(`SELECT delay_minutes FROM late_logs WHERE log_id = $1`, [res.body.logId])).rows[0];
    expect(row.delay_minutes).toBe(45);
  });

  it('returns 409 with the existing record on a duplicate officer/date/shift (S3-03)', async () => {
    const first = await post('/api/late/log', late({ reason: 'First entry' }));
    const second = await post('/api/late/log', late({ reason: 'Second entry' }));

    expect(second.status).toBe(409);
    expect(second.body.existingRecord).toMatchObject({ logId: first.body.logId, reason: 'First entry' });
  });

  it('exactly one of two simultaneous identical submissions wins', async () => {
    const [r1, r2] = await Promise.all([post('/api/late/log', late()), post('/api/late/log', late())]);

    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM late_logs`)).rows[0].n).toBe(1);
  });

  it('allows an absence and a late report for the same officer/date/shift (separate event types)', async () => {
    expect((await post('/api/absence/log', absence())).status).toBe(201);
    expect((await post('/api/late/log', late())).status).toBe(201);
  });
});

describe('audit log listings', () => {
  it('lists newest first', async () => {
    const first = await post('/api/absence/log', absence({ date: '2026-03-01' }));
    await new Promise((r) => setTimeout(r, 20));
    const second = await post('/api/absence/log', absence({ date: '2026-03-02' }));

    const res = await request(app).get('/api/absence/logs').set(bearer(SM));

    expect(res.body.absenceLogs.map((l) => l.logId)).toEqual([second.body.logId, first.body.logId]);
  });

  it('exposes camelCase fields the clients rely on', async () => {
    await post('/api/late/log', late());
    const res = await request(app).get('/api/late/logs').set(bearer(SM));

    expect(res.body.lateLogs[0]).toEqual(expect.objectContaining({
      logId: expect.any(String), officerName: 'Guard A1', scheduledTime: '06:00:00', actualTime: '06:40:00',
      delayMinutes: 40, submittedBy: `${SM.epf} (${SM.name})`
    }));
  });
});

describe('who may log absence and late reports (SRS FR-4, FR-5)', () => {
  it.each([['VO', USERS.VO], ['NVO', USERS.NVO], ['SM', USERS.SM_1], ['Control Room', USERS.CR]])(
    'allows %s', async (_label, user) => {
      expect((await post('/api/absence/log', absence(), user)).status).toBe(201);
      expect((await post('/api/late/log', late(), user)).status).toBe(201);
    }
  );

  it.each([['MD', USERS.MD], ['GM', USERS.GM], ['AGM', USERS.AGM_W]])(
    'forbids %s from logging', async (_label, user) => {
      expect((await post('/api/absence/log', absence(), user)).status).toBe(403);
      expect((await post('/api/late/log', late(), user)).status).toBe(403);
      const { rows } = await pool.query('SELECT COUNT(*) FROM absence_logs');
      expect(rows[0].count).toBe('0');
    }
  );
});

/** Regression: the duplicate-entry 409 must not reveal a record from a site the caller cannot see. */
describe.each([
  ['absence', '/api/absence/log', absence],
  ['late', '/api/late/log', late]
])('duplicate %s entry across sites', (_name, path, build) => {
  const OTHER_SM = USERS.SM_2; // Sector 02: can see site C, not site A

  it('returns the existing record when it is inside the caller\'s scope', async () => {
    const first = await post(path, build({ reason: 'In scope' }));
    const second = await post(path, build());

    expect(second.status).toBe(409);
    expect(second.body.existingRecord).toMatchObject({ logId: first.body.logId, siteId: SITES.A.id });
  });

  it('hides a record that belongs to a site outside the caller\'s scope', async () => {
    const first = await post(path, build({ siteId: SITES.C.id, siteName: SITES.C.name, reason: 'Private to sector 02' }), OTHER_SM);
    expect(first.status).toBe(201);

    // SM One reports the same officer/date/shift at their own site A.
    const second = await post(path, build(), SM);

    expect(second.status).toBe(409);
    expect(second.body.existingRecord).toBeNull();
    expect(JSON.stringify(second.body)).not.toContain('Private to sector 02');
  });
});
