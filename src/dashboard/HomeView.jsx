import React, { useMemo, useState } from 'react';
import { Users, Building2, AlertTriangle, TrendingDown, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AbsenteeismTrendChart } from './AbsenteeismTrendChart';
import { NeedsAttention } from './NeedsAttention';

const unique = (values) => [...new Set(values)].sort();

const Kpi = ({ icon: Icon, tint, tone, value, label, note }) => (
  <div className="kpi" style={{ '--tint': tint, '--tone': tone }}>
    <div className="ico"><Icon size={18} aria-hidden="true" /></div>
    <div className="numeral">{value}</div>
    <div className="label">{label}</div>
    <div className="note">{note}</div>
  </div>
);

/**
 * Overview: the five readings, what needs attention now, the absenteeism trend and the site roster.
 * Everything shown is already limited to the viewer's role by the server.
 */
export const HomeView = ({ onGo }) => {
  const { currentUser, sites, kpis, lateLogs, absenceLogs, incidents } = useApp();
  const [region, setRegion] = useState('ALL');
  const [sector, setSector] = useState('ALL');

  const regions = useMemo(() => unique(sites.map((s) => s.region)), [sites]);
  const sectors = useMemo(
    () => unique(sites.filter((s) => region === 'ALL' || s.region === region).map((s) => s.sector)),
    [sites, region]
  );

  const inView = sites.filter((s) => (region === 'ALL' || s.region === region) && (sector === 'ALL' || s.sector === sector));
  // Counts can arrive as text (Postgres bigint), so convert before adding.
  const required = inView.reduce((sum, s) => sum + Number(s.requiredOfficers), 0);
  const onDuty = inView.reduce((sum, s) => sum + Number(s.currentOnDuty), 0);
  const short = Math.max(0, required - onDuty);
  const avgDelay = lateLogs.length > 0 ? Math.round(lateLogs.reduce((sum, l) => sum + (l.delayMinutes || 0), 0) / lateLogs.length) : 0;
  const pct = Math.round((onDuty / (required || 1)) * 100);

  const changeRegion = (value) => {
    setRegion(value);
    setSector('ALL');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>{currentUser.name}, {currentUser.title}. You can see {sites.length} {sites.length === 1 ? 'site' : 'sites'}.</p>
        </div>
      </div>

      <section aria-label="Key readings">
        <div className="kpis">
          <Kpi icon={Users} tint="var(--tint-green)" tone="var(--cleared)" value={onDuty} label="Officers on duty" note={`${pct}% of established posts`} />
          <Kpi icon={Building2} tint="var(--tint-blue)" tone="var(--info)" value={required} label="Officers required" note={`Across ${inView.length} ${inView.length === 1 ? 'site' : 'sites'}`} />
          <Kpi icon={AlertTriangle} tint="var(--tint-red)" tone="var(--alarm)" value={short} label="Officers short" note={short > 0 ? 'Relief guards needed' : 'Every post is filled'} />
          <Kpi icon={TrendingDown} tint="var(--tint-purple)" tone="var(--brand)" value={`${kpis.absenteeismPercentage ?? 0}%`} label="Absenteeism this month" note={kpis.trend ? `${kpis.trend}, last month ${kpis.priorMonthPercentage}%` : 'No history yet'} />
          <Kpi icon={Clock} tint="var(--tint-amber)" tone="var(--warn)" value={lateLogs.length} label="Late reports" note={lateLogs.length > 0 ? `Average delay ${avgDelay} min` : 'None logged yet'} />
        </div>
      </section>

      <section aria-labelledby="attention-heading" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div className="section-title">
          <h2 id="attention-heading">Needs attention now</h2>
          <button className="link-btn" onClick={() => onGo('incidents')}>View all incidents</button>
        </div>
        <NeedsAttention sites={sites} incidents={incidents} absenceLogs={absenceLogs} onGo={onGo} />
      </section>

      <section className="panel" aria-labelledby="trend-heading">
        <div className="panel-title">
          <h3 id="trend-heading">Absenteeism over six months</h3>
          <span>Across the {sites.length} {sites.length === 1 ? 'site' : 'sites'} you can see</span>
        </div>
        <div style={{ padding: '16px' }}>
          <AbsenteeismTrendChart monthlyTrend={kpis.monthlyTrend} />
        </div>
      </section>

      <section className="panel" id="site-roster" aria-labelledby="roster-heading">
        <div className="panel-title">
          <h3 id="roster-heading">Site roster</h3>
          <span>{inView.length} {inView.length === 1 ? 'site' : 'sites'} shown</span>
        </div>
        <div className="toolbar">
          <label>
            Region
            <select value={region} onChange={(e) => changeRegion(e.target.value)}>
              <option value="ALL">All regions</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>
            Sector
            <select value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="ALL">All sectors</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {inView.length === 0 ? (
          <p style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>No sites match these filters.</p>
        ) : (
          <div className="table-scroll">
            <table className="register">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Sector and region</th>
                  <th>Required</th>
                  <th>On duty</th>
                  <th>Short by</th>
                  <th>Assigned officers</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {inView.map((site) => {
                  const gap = site.shortfall > 0;
                  return (
                    <tr key={site.siteId}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{site.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{site.location}</div>
                      </td>
                      <td>
                        {site.sector}
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{site.region}</div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{site.requiredOfficers}</td>
                      <td style={{ fontWeight: 700, color: gap ? 'var(--alarm)' : 'var(--cleared)' }}>{site.currentOnDuty}</td>
                      <td style={{ fontWeight: 700, color: gap ? 'var(--alarm)' : 'var(--cleared)' }}>{gap ? site.shortfall : 0}</td>
                      <td style={{ fontSize: '13px', color: 'var(--muted)' }}>
                        <div>Day: {site.assignedVO || 'none'}</div>
                        <div>Night: {site.assignedNVO || 'none'}</div>
                      </td>
                      <td><span className={`badge ${gap ? 'badge-danger' : 'badge-success'}`}>{gap ? 'Short' : 'Staffed'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
