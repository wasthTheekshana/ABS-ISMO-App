import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, clearTransactional, closePool, bearer, USERS, SITES } from './helpers/fixtures.js';
import { REPORT_TYPES, localDate, isValidDate } from '../services/reports.js';
import { archiveDay, archiveIfMissing, yesterday } from '../jobs/dailyArchive.js';

/** Daily reports (SRS FR-18): the eight report types, role scoping and the nightly archive. */

const { VO, NVO, SM_1, SM_2, AGM_W, AGM_C, MD, GM, CR, GUARD, CLIENT } = USERS;
const TODAY = localDate();
const DAY = '2026-03-10';

const get = (path, user = MD) => request(app).get(path).set(bearer(user));
const report = async (type, user = MD, date = TODAY) => (await get(`/api/reports/daily?type=${type}&date=${date}`, user)).body;

// Timestamp at a local (Asia/Colombo) wall-clock time on a date.
const at = (date, time) => `(($1::date + time '${time}') AT TIME ZONE 'Asia/Colombo')`.replace('$1', `'${date}'`);

const addIncident = (id, o = {}) =>
  pool.query(
    `INSERT INTO incidents (incident_id, category, sub_type, severity, site_id, site_name, description, reported_by,
                            police_notified, hospital_notified, fire_notified, status, created_at, closed_at)
     VALUES ($1, 'Security', 'Theft', $2, $3, 'S', 'desc', 'reporter', $4, $5, $6, $7, ${at(o.date ?? TODAY, o.time ?? '10:00')}, ${o.closedAt ?? 'NULL'})`,
    [id, o.severity ?? 'Medium', o.siteId ?? SITES.A.id, o.police ?? false, o.hospital ?? false, o.fire ?? false, o.status ?? 'Open & Investigating']
  );

const addVisit = (id, role, time, o = {}) =>
  pool.query(
    `INSERT INTO site_visits (visit_id, officer_epf, officer_name, officer_role, site_id, site_name, arrived_at, departed_at,
                              duration_minutes, travel_km, on_site)
     VALUES ($1, $2, $3, $4, $5, 'S', ${at(o.date ?? TODAY, time)}, ${at(o.date ?? TODAY, o.departTime ?? '23:00')}, 30, 2.5, $6)`,
    [id, role === 'NVO' ? NVO.epf : VO.epf, role === 'NVO' ? NVO.name : VO.name, role, o.siteId ?? SITES.A.id, o.onSite ?? true]
  );

beforeAll(seedMasterData);
beforeEach(clearTransactional);
afterAll(closePool);

describe('access and validation', () => {
  it('lists the eight report types for staff', async () => {
    const res = await get('/api/reports/types', SM_1);
    expect(res.status).toBe(200);
    expect(res.body.types.map((t) => t.type).sort()).toEqual(Object.keys(REPORT_TYPES).sort());
  });

  it.each([['guard', GUARD], ['client', CLIENT]])('refuses %s', async (_l, user) => {
    expect((await get('/api/reports/types', user)).status).toBe(403);
    expect((await get('/api/reports/daily?type=kpi', user)).status).toBe(403);
  });

  it('rejects an unknown type and an invalid date', async () => {
    expect((await get('/api/reports/daily?type=secret')).status).toBe(400);
    expect((await get('/api/reports/daily')).status).toBe(400);
    expect((await get('/api/reports/daily?type=kpi&date=2026-02-31')).status).toBe(400);
    expect((await get('/api/reports/daily?type=kpi&date=today')).status).toBe(400);
  });

  it('requires a token', async () => {
    expect((await request(app).get('/api/reports/daily?type=kpi')).status).toBe(401);
  });

  it('isValidDate accepts real dates only', () => {
    expect(isValidDate('2026-03-10')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '10-03-2026', '', 'x']) expect(isValidDate(bad)).toBe(false);
  });
});

describe.each(Object.keys(REPORT_TYPES))('report shape: %s', (type) => {
  it('has a title, date, columns and rows, and every row carries every column', async () => {
    await addIncident('INC-SHAPE', { severity: 'Critical', police: true });
    await addVisit('VISIT-SHAPE', 'VO', '10:00');
    const body = await report(type);
    expect(body).toMatchObject({ type, title: REPORT_TYPES[type], date: TODAY });
    expect(Array.isArray(body.columns)).toBe(true);
    expect(body.columns.length).toBeGreaterThan(0);
    expect(Array.isArray(body.rows)).toBe(true);
    for (const row of body.rows) {
      for (const c of body.columns) expect(row).toHaveProperty(c.key);
    }
  });
});

describe('Daily Attendance Report', () => {
  it('counts check-ins, absences, late reports and shortfall per site, with a total', async () => {
    await pool.query(
      `INSERT INTO duty_attendance (epf, site_id, shift, status, date, check_in_time) VALUES
       ($1, $3, 'Day', 'On Duty', $4, now()), ($2, $3, 'Day', 'On Duty', $4, now())`,
      [VO.epf, NVO.epf, SITES.A.id, TODAY]
    );
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
       VALUES ('A1','E1','G',$1,'S',$2,'Day','sick','t')`, [SITES.A.id, TODAY]);
    await pool.query(
      `INSERT INTO late_logs (log_id, epf, officer_name, site_id, site_name, date, shift, scheduled_time, actual_time, delay_minutes, reason, submitted_by)
       VALUES ('L1','E1','G',$1,'S',$2,'Day','06:00','06:30',30,'bus','t')`, [SITES.A.id, TODAY]);

    const { rows } = await report('attendance');
    const a = rows.find((r) => r.site === SITES.A.name);
    expect(a).toMatchObject({ required: 10, checkedIn: 2, shortfall: 8, absences: 1, late: 1 });
    const total = rows.find((r) => r.site === 'TOTAL');
    expect(total).toMatchObject({ required: 50, checkedIn: 2, absences: 1, late: 1 });
    expect(total.shortfall).toBe(rows.filter((r) => r.site !== 'TOTAL').reduce((s, r) => s + r.shortfall, 0));
  });

  it('uses the date asked for, not today', async () => {
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
       VALUES ('A-OLD','E1','G',$1,'S',$2,'Day','sick','t')`, [SITES.A.id, DAY]);
    const old = (await report('attendance', MD, DAY)).rows.find((r) => r.site === SITES.A.name);
    expect(old.absences).toBe(1);
    expect((await report('attendance')).rows.find((r) => r.site === SITES.A.name).absences).toBe(0);
  });

  it('is limited to the caller\'s scope', async () => {
    const names = (user) => report('attendance', user).then((b) => b.rows.filter((r) => r.site !== 'TOTAL').map((r) => r.site));
    expect((await names(AGM_C))).toEqual([SITES.D.name]);
    expect((await names(SM_2))).toEqual([SITES.C.name]);
    expect((await names(MD)).length).toBe(4);
  });

  it('is empty (no total row) when the caller sees no sites', async () => {
    const unknown = { ...MD, role: 'AGM', region: 'Nowhere' };
    expect((await report('attendance', unknown)).rows).toEqual([]);
  });
});

describe('Daily Incident Report and Emergency Incident Report', () => {
  it('lists the day\'s incidents in time order and leaves out other days', async () => {
    await addIncident('INC-LATE', { time: '15:30' });
    await addIncident('INC-EARLY', { time: '08:05' });
    await addIncident('INC-OLD', { date: DAY });
    const rows = (await report('incidents')).rows;
    expect(rows.map((r) => r.id)).toEqual(['INC-EARLY', 'INC-LATE']);
    expect(rows[0].time).toBe('08:05');
  });

  it('puts Critical incidents and any with services called in the emergency report', async () => {
    await addIncident('INC-CRIT', { severity: 'Critical' });
    await addIncident('INC-POLICE', { severity: 'Low', police: true });
    await addIncident('INC-MULTI', { severity: 'Medium', hospital: true, fire: true });
    await addIncident('INC-MINOR', { severity: 'Low' });
    const rows = (await report('emergency')).rows;
    expect(rows.map((r) => r.id).sort()).toEqual(['INC-CRIT', 'INC-MULTI', 'INC-POLICE']);
    expect(rows.find((r) => r.id === 'INC-POLICE').services).toBe('Police');
    expect(rows.find((r) => r.id === 'INC-MULTI').services).toBe('Hospital/ambulance, Fire brigade');
    expect(rows.find((r) => r.id === 'INC-CRIT').services).toBe('None');
  });

  it('shows minutes to close for a closed emergency', async () => {
    await addIncident('INC-DONE', { severity: 'Critical', status: 'Closed', time: '10:00', closedAt: `(${at(TODAY, '10:45')})` });
    await addIncident('INC-OPEN', { severity: 'Critical', time: '11:00' });
    const rows = (await report('emergency')).rows;
    expect(rows.find((r) => r.id === 'INC-DONE').minutesToClose).toBe(45);
    expect(rows.find((r) => r.id === 'INC-OPEN').minutesToClose).toBeNull();
  });

  it('respects scope', async () => {
    await addIncident('INC-A', { siteId: SITES.A.id });
    await addIncident('INC-D', { siteId: SITES.D.id });
    expect((await report('incidents', SM_1)).rows.map((r) => r.id)).toEqual(['INC-A']);
    expect((await report('incidents', AGM_C)).rows.map((r) => r.id)).toEqual(['INC-D']);
  });
});

describe('Site Visit Report and Night Visit Report', () => {
  it('lists the day\'s visits with duration, travel and the on-site flag', async () => {
    await addVisit('V-DAY', 'VO', '10:00', { departTime: '10:30' });
    await addVisit('V-OFF', 'VO', '11:00', { onSite: false });
    const rows = (await report('visits')).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ officer: VO.name, role: 'VO', arrived: '10:00', departed: '10:30', minutes: 30, travelKm: 2.5, onSite: 'Yes' });
    expect(rows[1].onSite).toBe('No');
  });

  it('shows a visit still in progress as such', async () => {
    await pool.query(
      `INSERT INTO site_visits (visit_id, officer_epf, officer_name, officer_role, site_id, site_name, arrived_at)
       VALUES ('V-OPEN', $1, $2, 'VO', $3, 'S', now())`, [VO.epf, VO.name, SITES.A.id]);
    expect((await report('visits')).rows[0].departed).toBe('In progress');
  });

  it('puts NVO visits and evening or night arrivals in the night report only', async () => {
    await addVisit('V-NOON', 'VO', '12:00', { departTime: '12:30' });
    await addVisit('V-EVENING', 'VO', '19:15', { departTime: '19:45' });
    await addVisit('V-NVO', 'NVO', '02:00', { departTime: '02:40' });
    await addVisit('V-EARLY', 'VO', '05:30', { departTime: '05:50' });
    const night = (await report('night-visits')).rows;
    expect(night.map((r) => r.arrived).sort()).toEqual(['02:00', '05:30', '19:15']);
    expect(night.some((r) => r.arrived === '12:00')).toBe(false);
    expect((await report('visits')).rows).toHaveLength(4);
  });

  it('does not expose coordinates in any report row', async () => {
    await addVisit('V-GPS', 'VO', '10:00');
    const body = await report('visits');
    expect(JSON.stringify(body)).not.toMatch(/arrival_lat|arrivalLat|departureLat/);
  });

  it('respects scope', async () => {
    await addVisit('V-A', 'VO', '10:00');
    expect((await report('visits', SM_2)).rows).toEqual([]);
    expect((await report('visits', SM_1)).rows).toHaveLength(1);
  });
});

describe('Client Complaint Report', () => {
  const addFeedback = (id, complaint, rating = 2) =>
    pool.query(
      `INSERT INTO client_feedback (feedback_id, site_id, site_name, client_epf, client_name, punctuality, discipline, grooming,
                                    communication, overall_rating, complaints, is_complaint, created_at)
       VALUES ($1, $2, 'S', $3, 'Client', 3, 3, 3, 3, $4, $5, $6, ${at(TODAY, '14:20')})`,
      [id, SITES.A.id, CLIENT.epf, rating, complaint, complaint.length > 0]
    );

  it('lists only complaints, not plain feedback', async () => {
    await addFeedback('FB-C', 'Guard asleep');
    await addFeedback('FB-OK', '', 5);
    const rows = (await report('complaints')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ complaint: 'Guard asleep', rating: 2, status: 'New', time: '14:20', resolutionNotes: '' });
  });

  it('respects scope', async () => {
    await addFeedback('FB-C', 'Guard asleep');
    expect((await report('complaints', SM_2)).rows).toEqual([]);
    expect((await report('complaints', GM)).rows).toHaveLength(1);
  });
});

describe('KPI Report and Daily Operations Summary', () => {
  const value = (rows, metric) => rows.find((r) => r.metric === metric)?.value;

  it('computes the day\'s KPIs', async () => {
    await pool.query(
      `INSERT INTO duty_attendance (epf, site_id, shift, status, date, check_in_time) VALUES ($1, $2, 'Day', 'On Duty', $3, now())`,
      [VO.epf, SITES.A.id, TODAY]);
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
       VALUES ('A1','E1','G',$1,'S',$2,'Day','sick','t')`, [SITES.A.id, TODAY]);
    await addIncident('INC-OPEN');
    await addVisit('V1', 'VO', '10:00');
    const rows = (await report('kpi')).rows;
    expect(value(rows, 'Officers required')).toBe(50);
    expect(value(rows, 'Officers checked in')).toBe(1);
    expect(value(rows, 'Shortfall')).toBe(49);
    expect(value(rows, 'Guard absences')).toBe(1);
    expect(value(rows, 'Absenteeism that day (%)')).toBe(2);
    expect(value(rows, 'Incidents open at end of day')).toBe(1);
    expect(value(rows, 'Site visits')).toBe(1);
  });

  it('operations summary adds incident flow, night visits and client measures', async () => {
    await addIncident('INC-NEW', { severity: 'Critical' });
    await addIncident('INC-CLOSED', { status: 'Closed', closedAt: `(${at(TODAY, '16:00')})` });
    await addVisit('V-N', 'NVO', '01:00', { departTime: '01:30' });
    await pool.query(
      `INSERT INTO client_feedback (feedback_id, site_id, site_name, client_epf, client_name, punctuality, discipline, grooming,
                                    communication, overall_rating, complaints, is_complaint, created_at)
       VALUES ('FB1', $1, 'S', $2, 'C', 3, 3, 3, 3, 4, 'late', TRUE, ${at(TODAY, '12:00')}),
              ('FB2', $1, 'S', $2, 'C', 3, 3, 3, 3, 2, '', FALSE, ${at(TODAY, '12:05')})`,
      [SITES.A.id, CLIENT.epf]);
    const rows = (await report('operations')).rows;
    expect(value(rows, 'Reported today')).toBe(2);
    expect(value(rows, 'Closed today')).toBe(1);
    expect(value(rows, 'Open at end of day')).toBe(1);
    expect(value(rows, 'Critical open at end of day')).toBe(1);
    expect(value(rows, 'Night visits')).toBe(1);
    expect(value(rows, 'Feedback received')).toBe(2);
    expect(value(rows, 'Complaints')).toBe(1);
    expect(value(rows, 'Average overall rating')).toBe(3);
    expect(rows.every((r) => r.section)).toBe(true);
  });

  it('an incident closed on a later day still counts as open at the end of an earlier day', async () => {
    await addIncident('INC-LONG', { date: DAY, status: 'Closed', closedAt: `(${at('2026-03-12', '09:00')})` });
    expect(value((await report('kpi', MD, DAY)).rows, 'Incidents open at end of day')).toBe(1);
    expect(value((await report('kpi', MD, '2026-03-12')).rows, 'Incidents open at end of day')).toBe(0);
  });

  it('reports zeros and a dash on a day with no activity', async () => {
    const rows = (await report('operations', MD, DAY)).rows;
    expect(value(rows, 'Guard absences')).toBe(0);
    expect(value(rows, 'Average overall rating')).toBe('—');
  });

  it('is scoped: an SM only counts their own sites', async () => {
    expect(value((await report('kpi', SM_1)).rows, 'Officers required')).toBe(15);
    expect(value((await report('kpi', AGM_C)).rows, 'Officers required')).toBe(15);
  });
});

describe('nightly archive (FR-18)', () => {
  it('stores all eight reports for a date, organisation-wide, and the endpoint serves them', async () => {
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
       VALUES ('A-ARC','E1','G',$1,'S',$2,'Day','sick','t')`, [SITES.D.id, DAY]);
    expect(await archiveDay(DAY)).toBe(8);
    const { rows } = await pool.query('SELECT report_type FROM daily_reports WHERE report_date = $1', [DAY]);
    expect(rows.map((r) => r.report_type).sort()).toEqual(Object.keys(REPORT_TYPES).sort());

    const res = await get(`/api/reports/archive?type=attendance&date=${DAY}`, MD);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Daily Attendance Report');
    // Organisation-wide: includes site D even though the archive was not built for an AGM West.
    expect(res.body.rows.find((r) => r.site === SITES.D.name).absences).toBe(1);
  });

  it('keeps the stored copy even if the live data changes later', async () => {
    await archiveDay(DAY);
    await pool.query(
      `INSERT INTO absence_logs (log_id, epf, officer_name, site_id, site_name, date, shift, reason, submitted_by)
       VALUES ('A-LATE','E1','G',$1,'S',$2,'Day','sick','t')`, [SITES.A.id, DAY]);
    const archived = (await get(`/api/reports/archive?type=attendance&date=${DAY}`, GM)).body.rows.find((r) => r.site === SITES.A.name);
    const live = (await report('attendance', MD, DAY)).rows.find((r) => r.site === SITES.A.name);
    expect(archived.absences).toBe(0);
    expect(live.absences).toBe(1);
  });

  it('re-running replaces the earlier copy instead of duplicating it', async () => {
    await archiveDay(DAY);
    await archiveDay(DAY);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM daily_reports WHERE report_date = $1', [DAY])).rows[0].n).toBe(8);
  });

  it('archiveIfMissing generates once and then does nothing', async () => {
    expect(await archiveIfMissing(DAY)).toBe(true);
    expect(await archiveIfMissing(DAY)).toBe(false);
  });

  it('archiveIfMissing completes a partial archive', async () => {
    await archiveDay(DAY);
    await pool.query(`DELETE FROM daily_reports WHERE report_date = $1 AND report_type = 'kpi'`, [DAY]);
    expect(await archiveIfMissing(DAY)).toBe(true);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM daily_reports WHERE report_date = $1', [DAY])).rows[0].n).toBe(8);
  });

  it('404s when nothing is archived and 400s on bad input', async () => {
    expect((await get(`/api/reports/archive?type=kpi&date=${DAY}`, MD)).status).toBe(404);
    expect((await get('/api/reports/archive?type=nope&date=2026-03-10', MD)).status).toBe(400);
    expect((await get('/api/reports/archive?type=kpi&date=bad', MD)).status).toBe(400);
  });

  it.each([['SM', SM_1], ['AGM', AGM_W], ['CR', CR], ['VO', VO], ['guard', GUARD], ['client', CLIENT]])(
    'keeps the organisation-wide archive from %s', async (_l, user) => {
      await archiveDay(DAY);
      expect((await get(`/api/reports/archive?type=kpi&date=${DAY}`, user)).status).toBe(403);
    }
  );

  it('yesterday() is the previous day in the operating time zone', () => {
    const now = new Date('2026-03-10T20:00:00Z'); // 01:30 on the 11th in Colombo
    expect(yesterday(now)).toBe('2026-03-10');
    expect(localDate(now)).toBe('2026-03-11');
  });
});
