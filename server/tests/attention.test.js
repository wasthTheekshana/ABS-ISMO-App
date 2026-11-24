import { describe, it, expect } from 'vitest';
import { buildAttention, ageText, colomboDate } from '../../src/utils/attention.js';

/** The "Needs attention now" ranking on the web dashboard home screen. */

const NOW = new Date('2026-11-20T08:00:00+05:30').getTime();
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

const site = (over = {}) => ({ siteId: 'S1', name: 'Biyagama EPZ', currentOnDuty: 22, requiredOfficers: 25, shortfall: 3, ...over });
const incident = (over = {}) => ({
  incidentId: 'INC-1', severity: 'High', subType: 'Theft', category: 'Security', siteName: 'Port Gate 3',
  status: 'Open & Investigating', createdAt: minsAgo(130), ...over
});
const absence = (over = {}) => ({
  logId: 'A1', officerName: 'K. Silva', siteName: 'Cargills Main', shift: 'Day', reason: 'Sick leave',
  replacementDeployed: false, date: '2026-11-20T00:00:00+05:30', timestamp: minsAgo(60), ...over
});

const run = (input) => buildAttention({ now: NOW, ...input });

describe('ageText', () => {
  it.each([[0, '0 min'], [5, '5 min'], [59, '59 min'], [60, '1 h 0 min'], [130, '2 h 10 min'], [60 * 24, '1 d 0 h'], [60 * 29, '1 d 5 h'], [-4, '0 min']])(
    '%i minutes reads %s', (m, text) => expect(ageText(m)).toBe(text)
  );
});

describe('colomboDate', () => {
  it('uses the operating time zone, not UTC', () => {
    // 01:30 on the 21st in Colombo is still the 20th in UTC.
    expect(colomboDate('2026-11-20T20:00:00Z')).toBe('2026-11-21');
    expect(colomboDate('2026-11-20T08:00:00Z')).toBe('2026-11-20');
  });
});

describe('buildAttention: what is included', () => {
  it('is empty when nothing needs attention', () => {
    expect(run({ sites: [site({ shortfall: 0 })], incidents: [incident({ status: 'Closed' })], absenceLogs: [] })).toEqual([]);
    expect(run({})).toEqual([]);
  });

  it('lists a short-staffed site in plain words, and omits fully staffed ones', () => {
    const items = run({ sites: [site(), site({ siteId: 'S2', name: 'Full Site', shortfall: 0 })] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'staffing', stamp: 'Short', tone: 'danger', what: 'Biyagama EPZ is 3 officers short' });
    expect(items[0].why).toBe('22 on duty, 25 needed.');
  });

  it('copes with counts that arrive as text, as Postgres bigint values do', () => {
    const [item] = run({ sites: [site({ shortfall: '1', currentOnDuty: '14', requiredOfficers: '15' })] });
    expect(item.what).toBe('Biyagama EPZ is 1 officer short');
    expect(item.why).toBe('14 on duty, 15 needed.');
    expect(run({ sites: [site({ shortfall: '0' })] })).toEqual([]);
  });

  it('uses the singular for one missing officer', () => {
    expect(run({ sites: [site({ shortfall: 1 })] })[0].what).toBe('Biyagama EPZ is 1 officer short');
  });

  it('lists open incidents with how long they have been open, and leaves out closed ones', () => {
    const items = run({ incidents: [incident(), incident({ incidentId: 'INC-2', status: 'Closed' })] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'incident', stamp: 'Open', what: 'High theft at Port Gate 3', why: 'Open for 2 h 10 min.' });
  });

  it('stamps an escalated incident and treats it as urgent whatever its severity', () => {
    const [item] = run({ incidents: [incident({ severity: 'Low', status: 'Escalated' })] });
    expect(item).toMatchObject({ stamp: 'Escalated', tone: 'danger' });
  });

  it('marks Medium and Low open incidents as a warning, not an alarm', () => {
    expect(run({ incidents: [incident({ severity: 'Medium' })] })[0].tone).toBe('warning');
    expect(run({ incidents: [incident({ severity: 'Low' })] })[0].tone).toBe('warning');
  });

  it('falls back to the category when an incident has no sub-type', () => {
    expect(run({ incidents: [incident({ subType: undefined, category: 'Medical' })] })[0].what).toBe('High medical at Port Gate 3');
  });

  it('lists today\'s absences with no replacement, not covered ones or other days', () => {
    const items = run({
      absenceLogs: [
        absence(),
        absence({ logId: 'A2', replacementDeployed: true }),
        absence({ logId: 'A3', date: '2026-11-19T00:00:00+05:30' })
      ]
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'absence', stamp: 'No cover', what: 'K. Silva was absent at Cargills Main' });
    expect(items[0].why).toBe('Day shift, sick leave. No replacement was sent.');
  });

  it('does not break on a missing reason', () => {
    expect(run({ absenceLogs: [absence({ reason: undefined })] })[0].why).toMatch(/no reason given/);
  });
});

describe('buildAttention: ranking', () => {
  it('puts a Critical incident above everything else', () => {
    const items = run({
      sites: [site({ shortfall: 10 })],
      incidents: [incident({ incidentId: 'LOW', severity: 'Low' }), incident({ incidentId: 'CRIT', severity: 'Critical' })],
      absenceLogs: [absence()]
    });
    expect(items[0].id).toBe('incident-CRIT');
  });

  it('keeps a Critical incident above a High one even when the High one is escalated', () => {
    // Critical scores 100; High (70) plus escalation (20) scores 90.
    const items = run({
      incidents: [incident({ incidentId: 'HIGH-ESC', severity: 'High', status: 'Escalated' }), incident({ incidentId: 'CRIT', severity: 'Critical' })]
    });
    expect(items.map((i) => i.id)).toEqual(['incident-CRIT', 'incident-HIGH-ESC']);
  });

  it('ranks a big shortfall above a day-old Low incident, and a small one below a No-cover absence', () => {
    const items = run({
      sites: [site({ siteId: 'BIG', name: 'Big gap', shortfall: 9 }), site({ siteId: 'SMALL', name: 'Small gap', shortfall: 1 })],
      incidents: [incident({ incidentId: 'LOW', severity: 'Low', createdAt: minsAgo(60 * 30) })],
      absenceLogs: [absence()]
    });
    expect(items.map((i) => i.id)).toEqual(['site-BIG', 'absence-A1', 'site-SMALL', 'incident-LOW']);
  });

  it('caps the weight of a shortfall so one huge gap cannot outrank a Critical incident', () => {
    const items = run({ sites: [site({ shortfall: 500 })], incidents: [incident({ severity: 'Critical' })] });
    expect(items[0].kind).toBe('incident');
  });

  it('among equals, the longer-waiting entry comes first', () => {
    const items = run({
      incidents: [
        incident({ incidentId: 'NEW', severity: 'High', createdAt: minsAgo(10) }),
        incident({ incidentId: 'OLD', severity: 'High', createdAt: minsAgo(500) })
      ]
    });
    expect(items.map((i) => i.id)).toEqual(['incident-OLD', 'incident-NEW']);
  });

  it('does not change the caller\'s arrays', () => {
    const sites = [site({ siteId: 'B', shortfall: 1 }), site({ siteId: 'A', shortfall: 9 })];
    const copy = JSON.stringify(sites);
    run({ sites });
    expect(JSON.stringify(sites)).toBe(copy);
  });
});
