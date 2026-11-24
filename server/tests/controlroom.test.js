import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';

/** Control Room operations board (SRS FR-20, UC-3 coordination). */

const { CR, MD, GM, SM_1, VO, AGM_W, GUARD, CLIENT } = USERS;

const board = (user = CR) => request(app).get('/api/control-room/board').set(bearer(user));

// Insert an incident with a controlled age, severity and status.
const addIncident = (id, { severity = 'Medium', status = 'Open & Investigating', minutesAgo = 10, siteId = SITES.A.id } = {}) =>
  pool.query(
    `INSERT INTO incidents (incident_id, category, sub_type, severity, site_id, site_name, description, reported_by, status, created_at)
     VALUES ($1, 'Security', 'Theft', $2, $3, 'S', 'desc', 't', $4, CURRENT_TIMESTAMP - ($5 || ' minutes')::interval)`,
    [id, severity, siteId, status, String(minutesAgo)]
  );

beforeAll(seedMasterData);
beforeEach(clearTransactional);
afterAll(closePool);

describe('access', () => {
  it.each([['Control Room', CR], ['MD', MD], ['GM', GM]])('%s may open the board', async (_l, user) => {
    expect((await board(user)).status).toBe(200);
  });

  it.each([['SM', SM_1], ['VO', VO], ['AGM', AGM_W], ['guard', GUARD], ['client', CLIENT]])(
    '%s is refused', async (_l, user) => {
      expect((await board(user)).status).toBe(403);
    }
  );

  it('requires a token', async () => {
    expect((await request(app).get('/api/control-room/board')).status).toBe(401);
  });
});

describe('incident queue', () => {
  it('lists only open incidents, most severe first, then escalated, then oldest first', async () => {
    await addIncident('I-LOW', { severity: 'Low', minutesAgo: 500 });
    await addIncident('I-CRIT-NEW', { severity: 'Critical', minutesAgo: 5 });
    await addIncident('I-CRIT-OLD', { severity: 'Critical', minutesAgo: 90 });
    await addIncident('I-CRIT-ESC', { severity: 'Critical', minutesAgo: 1, status: 'Escalated' });
    await addIncident('I-HIGH', { severity: 'High', minutesAgo: 30 });
    await addIncident('I-CLOSED', { severity: 'Critical', status: 'Closed' });

    const ids = (await board()).body.incidents.map((i) => i.incidentId);
    expect(ids).toEqual(['I-CRIT-ESC', 'I-CRIT-OLD', 'I-CRIT-NEW', 'I-HIGH', 'I-LOW']);
  });

  it('reports each incident\'s age in whole minutes', async () => {
    await addIncident('I-AGE', { minutesAgo: 125 });
    const row = (await board()).body.incidents[0];
    expect(row.ageMinutes).toBeGreaterThanOrEqual(125);
    expect(row.ageMinutes).toBeLessThanOrEqual(127);
  });

  it('summarises open, critical, escalated and the oldest open incident', async () => {
    await addIncident('I-1', { severity: 'Critical', minutesAgo: 200 });
    await addIncident('I-2', { severity: 'High', status: 'Escalated', minutesAgo: 20 });
    await addIncident('I-3', { severity: 'Low', status: 'Closed', minutesAgo: 900 });
    const { summary } = (await board()).body;
    expect(summary).toMatchObject({ openIncidents: 2, criticalOpen: 1, escalated: 1 });
    expect(summary.oldestOpenMinutes).toBeGreaterThanOrEqual(200);
  });

  it('is empty and zeroed when nothing is open', async () => {
    const { incidents, summary } = (await board()).body;
    expect(incidents).toEqual([]);
    expect(summary).toMatchObject({ openIncidents: 0, criticalOpen: 0, escalated: 0, oldestOpenMinutes: 0 });
  });
});

describe('sites needing attention', () => {
  it('lists sites below their required headcount, biggest shortfall first', async () => {
    const { sites, summary } = (await board()).body;
    // Fixture: A 8/10 (short 2), B 5/5, C 15/20 (short 5), D 15/15.
    expect(sites.map((s) => s.siteId)).toEqual([SITES.C.id, SITES.A.id]);
    expect(sites[0]).toMatchObject({ shortfall: 5, requiredOfficers: 20, currentOnDuty: 15 });
    expect(summary.sitesNeedingAttention).toBe(2);
  });

  it('uses live check-ins once a site has any today', async () => {
    await pool.query(
      `INSERT INTO duty_attendance (epf, site_id, shift, status, date, check_in_time) VALUES ($1, $2, 'Day', 'On Duty', CURRENT_DATE, CURRENT_TIMESTAMP)`,
      [USERS.VO.epf, SITES.B.id]
    );
    const { sites, summary } = (await board()).body;
    const b = sites.find((s) => s.siteId === SITES.B.id);
    expect(b).toMatchObject({ currentOnDuty: 1, shortfall: 4 });
    expect(summary.onDutyNow).toBe(1);
  });

  it('includes a site flagged Alert even with full cover', async () => {
    await pool.query(`UPDATE sites SET status = 'Alert' WHERE site_id = $1`, [SITES.D.id]);
    const ids = (await board()).body.sites.map((s) => s.siteId);
    expect(ids).toContain(SITES.D.id);
  });
});

describe("today's absences and late reports", () => {
  it('lists only today\'s entries', async () => {
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by) VALUES
       ('A-TODAY','E1','G1',$1,'S',CURRENT_DATE,'Day','sick','t'),
       ('A-OLD','E2','G2',$1,'S',CURRENT_DATE - 1,'Day','sick','t')`, [SITES.A.id]);
    await pool.query(
      `INSERT INTO late_logs (log_id, epf, officer_name, site_id, site_name, date, shift, scheduled_time, actual_time, delay_minutes, reason, submitted_by) VALUES
       ('L-TODAY','E1','G1',$1,'S',CURRENT_DATE,'Day','06:00','06:40',40,'bus','t'),
       ('L-OLD','E2','G2',$1,'S',CURRENT_DATE - 1,'Day','06:00','06:20',20,'bus','t')`, [SITES.A.id]);

    const body = (await board()).body;
    expect(body.absencesToday.map((a) => a.logId)).toEqual(['A-TODAY']);
    expect(body.lateToday.map((l) => l.logId)).toEqual(['L-TODAY']);
    expect(body.lateToday[0].delayMinutes).toBe(40);
    expect(body.summary).toMatchObject({ absencesToday: 1, lateToday: 1 });
  });
});
