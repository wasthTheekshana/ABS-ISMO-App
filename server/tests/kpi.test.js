import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';

/**
 * SRS FR-1..FR-3: the five Pilot KPIs, checked against hand-computed figures.
 * Fixture totals (MD view): required 10+5+20+15 = 50, baseline on-duty 8+5+15+15 = 43,
 * shortfall 2+0+5+0 = 7.
 */

const kpis = async (user = USERS.MD) =>
  (await request(app).get('/api/kpis/executive').set(bearer(user))).body.kpis;

const round2 = (n) => Number(n.toFixed(2));

// Insert an absence dated `dayOffset` days into the month that is `monthsAgo` months back.
const addAbsence = (n, siteId, monthsAgo, dayOffset) =>
  pool.query(
    `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
     VALUES ($1, $2, 'G', $3, 'S', (date_trunc('month', CURRENT_DATE) - ($4 || ' months')::interval)::date + $5::int, 'Day', 'r', 't')`,
    [`ABS-K-${n}`, `K-${n}`, siteId, String(monthsAgo), dayOffset]
  );

const addLate = (n, siteId, monthsAgo, dayOffset) =>
  pool.query(
    `INSERT INTO late_logs (log_id, epf, officer_name, site_id, site_name, date, shift, scheduled_time, actual_time, delay_minutes, reason, submitted_by)
     VALUES ($1, $2, 'G', $3, 'S', (date_trunc('month', CURRENT_DATE) - ($4 || ' months')::interval)::date + $5::int, 'Day', '06:00', '06:30', 30, 'r', 't')`,
    [`LATE-K-${n}`, `K-${n}`, siteId, String(monthsAgo), dayOffset]
  );

beforeAll(seedMasterData);
beforeEach(clearTransactional);
afterAll(closePool);

describe('headcount KPIs (FR-1, FR-2)', () => {
  it('reports required, baseline on-duty and shortfall across all sites for MD', async () => {
    const k = await kpis();

    expect(k.totalRequired).toBe(50);
    expect(k.totalOnDuty).toBe(43);
    expect(k.totalShortfall).toBe(7);
  });

  it('is scoped: SM Sector 01 sees only sites A and B', async () => {
    const k = await kpis(USERS.SM_1);

    expect(k.totalRequired).toBe(15);
    expect(k.totalOnDuty).toBe(13);
    expect(k.totalShortfall).toBe(2);
  });

  it('switches a site to its LIVE open check-in count once someone is checked in today', async () => {
    await pool.query(
      `INSERT INTO duty_attendance (epf, site_id, shift, check_in_time, status, date)
       VALUES ('T-VO', $1, 'Day', NOW(), 'Checked In', CURRENT_DATE)`,
      [SITES.A.id]
    );
    const k = await kpis();

    // Site A: baseline 8 -> live 1. Others unchanged: 1 + 5 + 15 + 15 = 36.
    expect(k.totalOnDuty).toBe(36);
    expect(k.totalShortfall).toBe(9 + 0 + 5 + 0);
  });

  it('never reports a negative shortfall when a site is over-staffed', async () => {
    await pool.query(`UPDATE sites SET current_on_duty = 99 WHERE site_id = $1`, [SITES.B.id]);
    const k = await kpis();

    expect(k.totalShortfall).toBe(2 + 0 + 5 + 0);
  });
});

describe('absence & late counts (FR-4, FR-5)', () => {
  it('counts every logged absence and late report in scope', async () => {
    await addAbsence(1, SITES.A.id, 0, 1);
    await addAbsence(2, SITES.A.id, 1, 1);
    await addAbsence(3, SITES.D.id, 0, 2);
    await addLate(1, SITES.B.id, 0, 1);

    const md = await kpis();
    const agmWest = await kpis(USERS.AGM_W);

    expect(md.totalAbsenceCount).toBe(3);
    expect(md.totalLateCount).toBe(1);
    expect(agmWest.totalAbsenceCount).toBe(2); // site D (Central) excluded
    expect(agmWest.totalLateCount).toBe(1);
  });
});

describe('monthly absenteeism % and trend (FR-3)', () => {
  // absences: 3 this month @A, 1 last month @A, 6 two months ago @C.
  beforeEach(async () => {
    for (let i = 0; i < 3; i++) await addAbsence(`c${i}`, SITES.A.id, 0, i);
    await addAbsence('p0', SITES.A.id, 1, 0);
    for (let i = 0; i < 6; i++) await addAbsence(`q${i}`, SITES.C.id, 2, i);
  });

  it('computes absenteeism as absences / (required officers x 30 days) for each of the last 6 months', async () => {
    const k = await kpis();
    const pct = (n) => round2((n / (50 * 30)) * 100);

    expect(k.monthlyTrend).toHaveLength(6);
    expect(k.monthlyTrend.map((m) => m.absenteeismPercentage)).toEqual([0, 0, 0, pct(6), pct(1), pct(3)]);
  });

  it('exposes current and prior month percentages and a Worsening delta', async () => {
    const k = await kpis();
    const current = round2((3 / 1500) * 100);
    const prior = round2((1 / 1500) * 100);
    const delta = round2(current - prior);

    expect(k.absenteeismPercentage).toBe(current);
    expect(k.priorMonthPercentage).toBe(prior);
    expect(k.trend).toBe(`Worsening (+${delta}%)`);
  });

  it('labels each trend point with a month name, oldest first', async () => {
    const k = await kpis();
    const months = k.monthlyTrend.map((m) => m.month);

    expect(months.every((m) => /^[A-Z][a-z]{2} \d{4}$/.test(m))).toBe(true);
    expect(new Set(months).size).toBe(6);
  });

  it('reports "Improving" when this month is lower than last month', async () => {
    await clearTransactional();
    await addAbsence('a', SITES.A.id, 1, 0);
    await addAbsence('b', SITES.A.id, 1, 1);
    await addAbsence('c', SITES.A.id, 0, 0);

    const k = await kpis();

    expect(k.trend).toMatch(/^Improving \(-/);
  });

  it('reports Flat (0.00%) when there are no absences at all', async () => {
    await clearTransactional();
    const k = await kpis();

    expect(k.absenteeismPercentage).toBe(0);
    expect(k.trend).toBe('Flat (0.00%)');
  });

  it('computes the trend over the caller\'s scope only (AGM Central: site D has no absences)', async () => {
    const k = await kpis(USERS.AGM_C);

    expect(k.monthlyTrend.every((m) => m.absenteeismPercentage === 0)).toBe(true);
  });

  it('breaks absenteeism down per site for the current and prior month', async () => {
    const k = await kpis();
    const a = k.siteBreakdown.find((s) => s.siteId === SITES.A.id);
    const c = k.siteBreakdown.find((s) => s.siteId === SITES.C.id);

    expect(k.siteBreakdown.map((s) => s.siteId).sort()).toEqual(Object.values(SITES).map((s) => s.id).sort());
    expect(a).toMatchObject({
      currentAbsenceCount: 3, priorAbsenceCount: 1,
      currentAbsenteeismPercentage: round2((3 / (10 * 30)) * 100),
      priorAbsenteeismPercentage: round2((1 / (10 * 30)) * 100),
      sector: 'Sector 01', region: 'Western'
    });
    expect(c).toMatchObject({ currentAbsenceCount: 0, priorAbsenceCount: 0 }); // C's absences are 2 months old
  });

  it('includes current-month late counts in the per-site breakdown', async () => {
    await addLate(1, SITES.B.id, 0, 0);
    await addLate(2, SITES.B.id, 0, 1);
    await addLate(3, SITES.B.id, 1, 0); // last month: not counted as current

    const k = await kpis();

    expect(k.siteBreakdown.find((s) => s.siteId === SITES.B.id).currentLateCount).toBe(2);
  });
});

describe('response shape consumed by the dashboard', () => {
  it('returns all documented KPI fields with numeric types', async () => {
    const k = await kpis();

    for (const f of ['totalRequired', 'totalOnDuty', 'totalShortfall', 'totalAbsenceCount', 'totalLateCount', 'absenteeismPercentage', 'priorMonthPercentage']) {
      expect(typeof k[f]).toBe('number');
    }
    expect(typeof k.trend).toBe('string');
    expect(Array.isArray(k.monthlyTrend)).toBe(true);
    expect(Array.isArray(k.siteBreakdown)).toBe(true);
  });
});

describe('AGM / SM breakdown (FR-1, FR-3)', () => {
  it('names the AGM (by region) and SM (by sector) on every site row', async () => {
    const k = await kpis();
    const a = k.siteBreakdown.find((s) => s.siteId === SITES.A.id);
    expect(a.agm).toBe(USERS.AGM_W.name);
    expect(a.sm).toBe(USERS.SM_1.name);
    expect(k.siteBreakdown.find((s) => s.siteId === SITES.D.id).agm).toBe(USERS.AGM_C.name);
    expect(a.requiredOfficers).toBe(SITES.A.required);
  });
});

describe('custom date range (UC-1 step 5)', () => {
  const get = (qs, user = USERS.MD) => request(app).get(`/api/kpis/executive${qs}`).set(bearer(user));

  it('has no range block when no dates are given', async () => {
    expect((await kpis()).range).toBeNull();
  });

  it('counts only absences/lates inside the range, per site and in total', async () => {
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by) VALUES
       ('ABS-R-1','R-1','G',$1,'S','2026-03-05','Day','r','t'),
       ('ABS-R-2','R-2','G',$1,'S','2026-03-20','Day','r','t'),
       ('ABS-R-3','R-3','G',$1,'S','2026-04-02','Day','r','t')`, [SITES.A.id]);
    await addLate('R1', SITES.A.id, 0, 0);
    const res = await get('?from=2026-03-01&to=2026-03-31');
    expect(res.status).toBe(200);
    const { range, siteBreakdown } = res.body.kpis;
    expect(range).toMatchObject({ from: '2026-03-01', to: '2026-03-31', days: 31, absenceCount: 2 });
    expect(range.absenteeismPercentage).toBe(round2((2 / (50 * 31)) * 100));
    const a = siteBreakdown.find((s) => s.siteId === SITES.A.id);
    expect(a.rangeAbsenceCount).toBe(2);
    expect(a.rangeAbsenteeismPercentage).toBe(round2((2 / (SITES.A.required * 31)) * 100));
  });

  it('keeps the range inside the caller\'s scope', async () => {
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
       VALUES ('ABS-R-D','R-D','G',$1,'S','2026-03-05','Day','r','t')`, [SITES.D.id]);
    const res = await get('?from=2026-03-01&to=2026-03-31', USERS.AGM_W);
    expect(res.body.kpis.range.absenceCount).toBe(0);
  });

  it.each(['?from=2026-03-01', '?from=bad&to=2026-03-31', '?from=2026-03-31&to=2026-03-01',
           '?from=2026-02-31&to=2026-03-31', '?from=2020-01-01&to=2026-01-01'])(
    'rejects %s with 400', async (qs) => {
      expect((await get(qs)).status).toBe(400);
    }
  );
});
