import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Flame, Clock, Building2, UserX, Timer, Users } from 'lucide-react';
import { apiService } from '../services/api';
import { IncidentsTable } from './RecordTables';

const REFRESH_MS = 30000;

const th = { padding: '10px 16px' };
const headRow = { borderBottom: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '11px', textTransform: 'none' };

const formatAge = (minutes) => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return h < 24 ? `${h} h ${minutes % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
};

const Tile = ({ icon, label, value, tone }) => (
  <div className="tile" style={{ '--tone': tone }}>
    <div className="label">{icon}{label}</div>
    <div className="numeral">{value}</div>
  </div>
);

const Panel = ({ title, count, children }) => (
  <div className="glass-panel" style={{ overflow: 'hidden' }}>
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between' }}>
      <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--ink)' }}>{title}</h3>
      <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{count}</span>
    </div>
    {children}
  </div>
);

const Empty = ({ children }) => <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>{children}</div>;

/**
 * Live operations board for the Control Room (SRS FR-20, UC-3): what is open, where cover is
 * short, and what went wrong today. Refreshes itself every 30 seconds.
 */
export const ControlRoomBoard = () => {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setBoard(await apiService.getControlRoomBoard());
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not load the operations board');
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!board) {
    return <div style={{ padding: '24px', color: 'var(--muted)' }}>{error ? `Operations board unavailable: ${error}` : 'Loading operations board...'}</div>;
  }

  const { summary, incidents, sites, absencesToday, lateToday } = board;

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <h2 style={{ fontSize: '26px', fontWeight: '800', color: 'var(--ink)' }}>Control room<span className="live-badge">Live</span></h2>
        <span style={{ fontSize: '11px', color: error ? 'var(--alarm)' : 'var(--dim)' }}>
          {error ? `Refresh failed (${error}); showing data from ` : 'Updated '}
          {new Date(board.generatedAt).toLocaleTimeString()} · refreshes every 30 s
        </span>
      </div>

      <div className="tiles">
        <Tile icon={<ShieldAlert size={16} color="currentColor" />} label="Open incidents" value={summary.openIncidents} tone="var(--alarm)" />
        <Tile icon={<Flame size={16} color="currentColor" />} label="Critical open" value={summary.criticalOpen} tone={summary.criticalOpen > 0 ? 'var(--alarm)' : 'var(--cleared)'} />
        <Tile icon={<ShieldAlert size={16} color="currentColor" />} label="Escalated" value={summary.escalated} tone="var(--brass-ink)" />
        <Tile icon={<Clock size={16} color="currentColor" />} label="Oldest open" value={summary.openIncidents ? formatAge(summary.oldestOpenMinutes) : '—'} tone="var(--brass-ink)" />
        <Tile icon={<Building2 size={16} color="currentColor" />} label="Sites short-staffed" value={summary.sitesNeedingAttention} tone={summary.sitesNeedingAttention > 0 ? 'var(--alarm)' : 'var(--cleared)'} />
        <Tile icon={<Users size={16} color="currentColor" />} label="Officers on duty now" value={summary.onDutyNow} tone="var(--cleared)" />
        <Tile icon={<UserX size={16} color="currentColor" />} label="Absences today" value={summary.absencesToday} tone="var(--brass-ink)" />
        <Tile icon={<Timer size={16} color="currentColor" />} label="Late today" value={summary.lateToday} tone="var(--info)" />
      </div>

      <Panel title="Open incidents — most severe first" count={`${incidents.length} open`}>
        {incidents.length === 0
          ? <Empty>No open incidents. All clear.</Empty>
          : <IncidentsTable incidents={incidents} canManage onChanged={load} />}
      </Panel>

      <Panel title="Sites needing attention" count={`${sites.length} sites`}>
        {sites.length === 0 ? <Empty>Every site is at its required headcount.</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={headRow}>
                  <th style={th}>SITE</th><th style={th}>SECTOR</th><th style={th}>ON DUTY</th><th style={th}>REQUIRED</th>
                  <th style={th}>SHORTFALL</th><th style={th}>VO</th><th style={th}>NVO</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.siteId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...th, color: 'var(--ink-2)' }}>{s.name}</td>
                    <td style={{ ...th, color: 'var(--dim)', fontSize: '12px' }}>{s.sector}</td>
                    <td style={{ ...th, color: 'var(--ink)' }}>{s.currentOnDuty}</td>
                    <td style={{ ...th, color: 'var(--muted)' }}>{s.requiredOfficers}</td>
                    <td style={{ ...th, fontWeight: '700', color: s.shortfall > 0 ? 'var(--alarm)' : 'var(--cleared)' }}>{s.shortfall > 0 ? `-${s.shortfall}` : '0'}</td>
                    <td style={{ ...th, color: 'var(--muted)', fontSize: '12px' }}>{s.assignedVO || '—'}</td>
                    <td style={{ ...th, color: 'var(--muted)', fontSize: '12px' }}>{s.assignedNVO || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: '20px' }}>
        <Panel title="Absences today" count={`${absencesToday.length}`}>
          {absencesToday.length === 0 ? <Empty>No absences logged today.</Empty> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead><tr style={headRow}><th style={th}>OFFICER</th><th style={th}>SITE</th><th style={th}>SHIFT</th><th style={th}>REPLACED</th></tr></thead>
                <tbody>
                  {absencesToday.map((a) => (
                    <tr key={a.logId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ ...th, color: 'var(--ink-2)' }}>{a.officerName}<div style={{ fontSize: '11px', color: 'var(--dim)' }}>{a.reason}</div></td>
                      <td style={{ ...th, color: 'var(--muted)' }}>{a.siteName}</td>
                      <td style={{ ...th, color: 'var(--muted)' }}>{a.shift}</td>
                      <td style={th}><span className={`badge ${a.replacementDeployed ? 'badge-success' : 'badge-danger'}`}>{a.replacementDeployed ? 'Yes' : 'No'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Late reporting today" count={`${lateToday.length}`}>
          {lateToday.length === 0 ? <Empty>No late reports logged today.</Empty> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead><tr style={headRow}><th style={th}>OFFICER</th><th style={th}>SITE</th><th style={th}>SHIFT</th><th style={th}>DELAY</th></tr></thead>
                <tbody>
                  {lateToday.map((l) => (
                    <tr key={l.logId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ ...th, color: 'var(--ink-2)' }}>{l.officerName}<div style={{ fontSize: '11px', color: 'var(--dim)' }}>{l.reason}</div></td>
                      <td style={{ ...th, color: 'var(--muted)' }}>{l.siteName}</td>
                      <td style={{ ...th, color: 'var(--muted)' }}>{l.shift}</td>
                      <td style={{ ...th, color: 'var(--info)', fontWeight: '700' }}>{l.delayMinutes} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};
