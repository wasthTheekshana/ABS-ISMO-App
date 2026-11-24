import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS } from './helpers/fixtures.js';

/**
 * SRS NFR: "The Pilot dashboard shall load within 3 seconds under normal load."
 *
 * Seeds a deliberately LARGER dataset than the Pilot will start with (300 sites, ~1,500
 * guards, 24 months of absence/late history) and asserts the executive KPI endpoint stays
 * inside the budget for the widest scope (MD) and a narrow one (SM), cold and warm.
 * Response times are printed so they can go in the UAT report.
 */

const BUDGET_MS = 3000;
const SITE_COUNT = 300;
const GUARDS_PER_SITE = 5;
const ABSENCES_PER_SITE = 60; // ~2.5 / month over 24 months
const LATES_PER_SITE = 60;

const timed = async (user) => {
  const start = performance.now();
  const res = await request(app).get('/api/kpis/executive').set(bearer(user));
  return { res, ms: performance.now() - start };
};

const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];

beforeAll(async () => {
  await seedMasterData();
  await clearTransactional();

  const regions = ['Western', 'Central', 'Southern', 'Northern'];
  await pool.query(
    `INSERT INTO sites (site_id, name, sector, region, required_officers, current_on_duty, status, location)
     SELECT 'P-SITE-' || g, 'Perf Site ' || g, 'Sector ' || (g % 12), ($1::text[])[1 + (g % 4)],
            10 + (g % 20), 8 + (g % 20), 'Optimal', 'perf'
     FROM generate_series(1, $2) g`,
    [regions, SITE_COUNT]
  );
  await pool.query(
    `INSERT INTO security_guards (epf, name, rank, site_id)
     SELECT 'P-G-' || s || '-' || n, 'Guard ' || s || '-' || n, 'Security Guard', 'P-SITE-' || s
     FROM generate_series(1, $1) s, generate_series(1, $2) n`,
    [SITE_COUNT, GUARDS_PER_SITE]
  );
  await pool.query(
    `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
     SELECT 'ABS-P-' || s || '-' || n, 'P-G-' || s || '-' || (1 + n % $3), 'Guard', 'P-SITE-' || s, 'Perf Site',
            (CURRENT_DATE - (n * 12) * INTERVAL '1 day')::date, 'Day', 'perf', 'perf'
     FROM generate_series(1, $1) s, generate_series(1, $2) n`,
    [SITE_COUNT, ABSENCES_PER_SITE, GUARDS_PER_SITE]
  );
  await pool.query(
    `INSERT INTO late_logs (log_id, epf, officer_name, site_id, site_name, date, shift, scheduled_time, actual_time, delay_minutes, reason, submitted_by)
     SELECT 'LATE-P-' || s || '-' || n, 'P-G-' || s || '-' || (1 + n % $3), 'Guard', 'P-SITE-' || s, 'Perf Site',
            (CURRENT_DATE - (n * 12) * INTERVAL '1 day')::date, 'Day', '06:00', '06:20', 20, 'perf', 'perf'
     FROM generate_series(1, $1) s, generate_series(1, $2) n`,
    [SITE_COUNT, LATES_PER_SITE, GUARDS_PER_SITE]
  );
  await pool.query('ANALYZE');
}, 120000);

afterAll(closePool);

describe(`executive dashboard performance (${SITE_COUNT} sites, ${SITE_COUNT * ABSENCES_PER_SITE} absence + ${SITE_COUNT * LATES_PER_SITE} late logs)`, () => {
  it(`MD (widest scope) first request completes within ${BUDGET_MS} ms`, async () => {
    const { res, ms } = await timed(USERS.MD);

    console.log(`[perf] MD cold: ${ms.toFixed(0)} ms, ${res.body.kpis.siteBreakdown.length} sites in breakdown`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.siteBreakdown.length).toBeGreaterThanOrEqual(SITE_COUNT);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it(`MD p95 over 20 sequential requests is within ${BUDGET_MS} ms`, async () => {
    const samples = [];
    for (let i = 0; i < 20; i++) samples.push((await timed(USERS.MD)).ms);

    const p95 = percentile(samples, 95);
    console.log(`[perf] MD x20: p50 ${percentile(samples, 50).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, max ${Math.max(...samples).toFixed(0)} ms`);
    expect(p95).toBeLessThan(BUDGET_MS);
  });

  it(`stays within ${BUDGET_MS} ms with 10 concurrent dashboard loads`, async () => {
    const start = performance.now();
    const results = await Promise.all(Array.from({ length: 10 }, () => timed(USERS.MD)));
    const wall = performance.now() - start;
    const slowest = Math.max(...results.map((r) => r.ms));

    console.log(`[perf] MD concurrent x10: slowest ${slowest.toFixed(0)} ms, wall ${wall.toFixed(0)} ms`);
    expect(results.every((r) => r.res.status === 200)).toBe(true);
    expect(slowest).toBeLessThan(BUDGET_MS);
  });

  it(`a scoped SM load is within ${BUDGET_MS} ms`, async () => {
    const { res, ms } = await timed(USERS.SM_1);

    console.log(`[perf] SM: ${ms.toFixed(0)} ms`);
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it(`the site roster and absence audit log also load within ${BUDGET_MS} ms for MD`, async () => {
    for (const path of ['/api/sites', '/api/absence/logs', '/api/late/logs', '/api/officers']) {
      const start = performance.now();
      const res = await request(app).get(path).set(bearer(USERS.MD));
      const ms = performance.now() - start;

      console.log(`[perf] GET ${path}: ${ms.toFixed(0)} ms`);
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(BUDGET_MS);
    }
  });
});
