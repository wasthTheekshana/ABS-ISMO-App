import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

/**
 * Absenteeism breakdown (SRS FR-3): per site, rolled up by sector, AGM or Sector Manager, for the
 * current and prior month or for a date range the viewer picks (UC-1).
 */
export const AbsenteeismView = () => {
  const { sites, kpis, kpiRange, setKpiRange } = useApp();
  const [groupBy, setGroupBy] = useState('sector'); // 'sector' | 'agm' | 'sm'
  const [draftFrom, setDraftFrom] = useState(kpiRange?.from || '');
  const [draftTo, setDraftTo] = useState(kpiRange?.to || '');
  const rangeInvalid = !draftFrom || !draftTo || draftTo < draftFrom;
  const rangeActive = Boolean(kpis.range);

  const visibleIds = new Set(sites.map((s) => s.siteId));
  const rows = (kpis.siteBreakdown || []).filter((r) => visibleIds.has(r.siteId));

  const groupKey = (r) => {
    if (groupBy === 'agm') return r.agm ? `AGM ${r.agm}` : `AGM unassigned (${r.region})`;
    if (groupBy === 'sm') return r.sm ? `Sector Manager ${r.sm}` : `Sector Manager unassigned (${r.sector})`;
    return r.sector;
  };

  const groups = Object.values(
    rows.reduce((acc, r) => {
      const key = groupKey(r);
      if (!acc[key]) acc[key] = { name: key, sites: [], current: 0, prior: 0, range: 0, rangeLate: 0 };
      acc[key].sites.push(r);
      acc[key].current += r.currentAbsenceCount;
      acc[key].prior += r.priorAbsenceCount;
      acc[key].range += r.rangeAbsenceCount || 0;
      acc[key].rangeLate += r.rangeLateCount || 0;
      return acc;
    }, {})
  );

  const groupLabel = groupBy === 'agm' ? 'AGM' : groupBy === 'sm' ? 'Sector Manager' : 'Sector';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Absenteeism</h1>
          <p>Absences and late reports by site, for this month and last month or for dates you choose.</p>
        </div>
      </div>

      <section className="panel">
        <div className="toolbar">
          <label>
            Group by
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="sector">Sector</option>
              <option value="agm">AGM</option>
              <option value="sm">Sector Manager</option>
            </select>
          </label>
          <label>
            From
            <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={draftTo} min={draftFrom || undefined} onChange={(e) => setDraftTo(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={rangeInvalid} onClick={() => setKpiRange({ from: draftFrom, to: draftTo })}>Apply dates</button>
          {kpiRange && (
            <button className="btn-secondary" onClick={() => { setKpiRange(null); setDraftFrom(''); setDraftTo(''); }}>Clear dates</button>
          )}
        </div>

        {rangeActive && (
          <p style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', fontWeight: 600 }}>
            {kpis.range.from} to {kpis.range.to} ({kpis.range.days} days): {kpis.range.absenceCount} absences, {kpis.range.lateCount} late reports, {kpis.range.absenteeismPercentage}% absenteeism.
          </p>
        )}

        {groups.length === 0 ? (
          <p style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>No absences or late reports have been logged for the sites you can see.</p>
        ) : (
          <div className="table-scroll">
            <table className="register">
              <thead>
                <tr>
                  <th>{groupLabel} and site</th>
                  <th>Region</th>
                  {rangeActive ? (
                    <>
                      <th>Absences in range</th>
                      <th>Absenteeism in range</th>
                      <th>Late reports in range</th>
                    </>
                  ) : (
                    <>
                      <th>Absences this month</th>
                      <th>This month</th>
                      <th>Absences last month</th>
                      <th>Last month</th>
                      <th>Late reports this month</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <React.Fragment key={group.name}>
                    <tr className="subtotal">
                      <td colSpan={2}>{group.name}</td>
                      {rangeActive ? (
                        <>
                          <td className="num">{group.range}</td>
                          <td />
                          <td className="num">{group.rangeLate}</td>
                        </>
                      ) : (
                        <>
                          <td className="num">{group.current}</td>
                          <td />
                          <td className="num">{group.prior}</td>
                          <td />
                          <td />
                        </>
                      )}
                    </tr>
                    {group.sites.map((site) => (
                      <tr key={site.siteId}>
                        <td style={{ paddingLeft: '28px' }}>{site.name}</td>
                        <td style={{ color: 'var(--muted)' }}>{site.region}</td>
                        {rangeActive ? (
                          <>
                            <td className="num">{site.rangeAbsenceCount}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{site.rangeAbsenteeismPercentage}%</td>
                            <td className="num">{site.rangeLateCount}</td>
                          </>
                        ) : (
                          <>
                            <td className="num">{site.currentAbsenceCount}</td>
                            <td className="num" style={{ fontWeight: 700, color: site.currentAbsenteeismPercentage > site.priorAbsenteeismPercentage ? 'var(--alarm)' : 'var(--cleared)' }}>
                              {site.currentAbsenteeismPercentage}%
                            </td>
                            <td className="num">{site.priorAbsenceCount}</td>
                            <td className="num">{site.priorAbsenteeismPercentage}%</td>
                            <td className="num">{site.currentLateCount}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
