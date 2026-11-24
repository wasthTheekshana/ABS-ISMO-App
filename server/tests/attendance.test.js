import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';

/** FR-1 "officers currently on duty": check-in / check-out and the live count it drives. */

const VO = USERS.VO;
const NVO = USERS.NVO;

const checkIn = (user = VO, over = {}) =>
  request(app).post('/api/attendance/check-in').set(bearer(user))
    .send({ epf: user.epf, siteId: SITES.A.id, shift: 'Day', ...over });

const checkOut = (recordId, user = VO) =>
  request(app).post('/api/attendance/check-out').set(bearer(user)).send({ recordId });

const siteA = async () =>
  (await request(app).get('/api/sites').set(bearer(USERS.MD))).body.sites.find((s) => s.siteId === SITES.A.id);

beforeAll(seedMasterData);
beforeEach(clearTransactional);
afterAll(closePool);

describe('check-in', () => {
  it('opens a shift and returns the record ID', async () => {
    const res = await checkIn();

    expect(res.status).toBe(201);
    expect(res.body.recordId).toEqual(expect.any(Number));

    const row = (await pool.query(`SELECT * FROM duty_attendance WHERE id = $1`, [res.body.recordId])).rows[0];
    expect(row).toMatchObject({ epf: VO.epf, site_id: SITES.A.id, shift: 'Day', status: 'Checked In', check_out_time: null });
  });

  it('refuses a second check-in while a shift is still open (409)', async () => {
    await checkIn();
    const res = await checkIn(VO, { siteId: SITES.B.id });

    expect(res.status).toBe(409);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM duty_attendance`)).rows[0].n).toBe(1);
  });

  it('lets two different officers be on duty at once', async () => {
    expect((await checkIn(VO)).status).toBe(201);
    expect((await checkIn(NVO)).status).toBe(201);
  });

  it('only one of two simultaneous check-ins by the same officer opens a shift', async () => {
    const results = await Promise.all([checkIn(), checkIn()]);
    const open = (await pool.query(`SELECT COUNT(*)::int AS n FROM duty_attendance WHERE epf = $1 AND check_out_time IS NULL`, [VO.epf])).rows[0].n;

    expect(open).toBe(1);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it.each(['epf', 'siteId', 'shift'])('returns 400 when "%s" is missing', async (field) => {
    const body = { epf: VO.epf, siteId: SITES.A.id, shift: 'Day' };
    delete body[field];
    const res = await request(app).post('/api/attendance/check-in').set(bearer(VO)).send(body);

    expect(res.status).toBe(400);
  });
});

describe('check-out', () => {
  it('closes the shift', async () => {
    const { body } = await checkIn();
    const res = await checkOut(body.recordId);

    expect(res.status).toBe(200);
    const row = (await pool.query(`SELECT check_out_time, status FROM duty_attendance WHERE id = $1`, [body.recordId])).rows[0];
    expect(row.check_out_time).toBeInstanceOf(Date);
    expect(row.status).toBe('Completed Shift');
  });

  it('allows a new check-in after checking out', async () => {
    const { body } = await checkIn();
    await checkOut(body.recordId);

    expect((await checkIn()).status).toBe(201);
  });

  it('cannot close another officer\'s shift (404, record untouched)', async () => {
    const { body } = await checkIn(VO);
    const res = await checkOut(body.recordId, NVO);

    expect(res.status).toBe(404);
    const row = (await pool.query(`SELECT check_out_time FROM duty_attendance WHERE id = $1`, [body.recordId])).rows[0];
    expect(row.check_out_time).toBeNull();
  });

  it('cannot close the same shift twice', async () => {
    const { body } = await checkIn();
    await checkOut(body.recordId);

    expect((await checkOut(body.recordId)).status).toBe(404);
  });

  it('returns 404 for a record that does not exist', async () => {
    expect((await checkOut(999999)).status).toBe(404);
  });
});

describe('GET /api/attendance/mine', () => {
  it('shows the open shift and history, only for the caller', async () => {
    await checkIn(NVO);
    const { body } = await checkIn(VO);
    const res = await request(app).get('/api/attendance/mine').set(bearer(VO));

    expect(res.body.activeShift).toMatchObject({ siteId: SITES.A.id, shift: 'Day' });
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({ id: body.recordId, siteName: SITES.A.name });
  });

  it('has no active shift after check-out', async () => {
    const { body } = await checkIn();
    await checkOut(body.recordId);
    const res = await request(app).get('/api/attendance/mine').set(bearer(VO));

    expect(res.body.activeShift).toBeNull();
    expect(res.body.history).toHaveLength(1);
  });
});

describe('effect on the live "currently on duty" figure (FR-1)', () => {
  it('falls back to the seeded baseline when nobody has checked in', async () => {
    expect((await siteA()).currentOnDuty).toBe(SITES.A.onDuty);
  });

  it('counts only open check-ins once any exist today', async () => {
    await checkIn(VO);
    await checkIn(NVO);
    const a = await siteA();

    expect(a.currentOnDuty).toBe(2);
    expect(a.shortfall).toBe(SITES.A.required - 2);
  });

  it('drops to zero (not back to the baseline) once everyone has checked out', async () => {
    const first = await checkIn(VO);
    const second = await checkIn(NVO);
    await checkOut(first.body.recordId, VO);
    await checkOut(second.body.recordId, NVO);
    const a = await siteA();

    expect(a.currentOnDuty).toBe(0);
    expect(a.shortfall).toBe(SITES.A.required);
  });
});
