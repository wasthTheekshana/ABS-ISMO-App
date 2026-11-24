/**
 * "Needs attention now": the exceptions a manager should see first, ranked by urgency.
 * Pure functions over the data the dashboard already has, so the ranking can be tested.
 *
 * Each item: { id, kind, stamp, tone, what, why, score, when }
 *   tone is 'danger' | 'warning', used for the stamp colour.
 */

const SEVERITY_SCORE = { Critical: 100, High: 70, Medium: 40, Low: 20 };
const TZ = 'Asia/Colombo';

/** YYYY-MM-DD for a date or date string in the operating time zone. */
export const colomboDate = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(value));

/** "35 min", "2 h 10 min", "1 d 4 h". */
export const ageText = (minutes) => {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Counts can arrive as text (Postgres bigint), so coerce before comparing or adding.
const staffingItems = (sites) =>
  sites
    .filter((s) => Number(s.shortfall) > 0)
    .map((s) => {
      const gap = Number(s.shortfall);
      return {
        id: `site-${s.siteId}`,
        kind: 'staffing',
        stamp: 'Short',
        tone: 'danger',
        what: `${s.name} is ${plural(gap, 'officer')} short`,
        why: `${Number(s.currentOnDuty)} on duty, ${Number(s.requiredOfficers)} needed.`,
        score: 30 + Math.min(gap, 10) * 5
      };
    });

const incidentItems = (incidents, now) =>
  incidents
    .filter((i) => i.status !== 'Closed')
    .map((i) => {
      const escalated = i.status === 'Escalated';
      const minutes = (now - new Date(i.createdAt).getTime()) / 60000;
      const urgent = i.severity === 'Critical' || i.severity === 'High' || escalated;
      return {
        id: `incident-${i.incidentId}`,
        kind: 'incident',
        stamp: escalated ? 'Escalated' : 'Open',
        tone: urgent ? 'danger' : 'warning',
        what: `${i.severity} ${String(i.subType || i.category || 'incident').toLowerCase()} at ${i.siteName}`,
        why: `Open for ${ageText(minutes)}.`,
        score: (SEVERITY_SCORE[i.severity] ?? 40) + (escalated ? 20 : 0),
        when: new Date(i.createdAt).getTime()
      };
    });

const noCoverItems = (absenceLogs, today) =>
  absenceLogs
    .filter((a) => !a.replacementDeployed && colomboDate(a.date) === today)
    .map((a) => ({
      id: `absence-${a.logId}`,
      kind: 'absence',
      stamp: 'No cover',
      tone: 'warning',
      what: `${a.officerName} was absent at ${a.siteName}`,
      why: `${a.shift} shift, ${String(a.reason || 'no reason given').toLowerCase()}. No replacement was sent.`,
      score: 60,
      when: new Date(a.timestamp).getTime()
    }));

/**
 * @param {{ sites?: object[], incidents?: object[], absenceLogs?: object[], now?: number }} input
 * @returns {object[]} items, most urgent first
 */
export const buildAttention = ({ sites = [], incidents = [], absenceLogs = [], now = Date.now() } = {}) => {
  const today = colomboDate(now);
  return [...staffingItems(sites), ...incidentItems(incidents, now), ...noCoverItems(absenceLogs, today)]
    // Higher score first; among equals the older entry (it has waited longest) comes first.
    .sort((a, b) => b.score - a.score || (a.when ?? Infinity) - (b.when ?? Infinity) || a.what.localeCompare(b.what));
};
