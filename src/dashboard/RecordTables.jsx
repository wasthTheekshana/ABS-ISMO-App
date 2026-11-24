import React, { useState } from 'react';
import { apiService } from '../services/api';

/** SRS FR-15 checklist, in the SRS order. A null / missing value means "not recorded / not applicable". */
export const INSPECTION_CHECKS = [
  ['presenceCheck', 'Officers present'],
  ['uniformCheck', 'Uniform'],
  ['idCheck', 'ID cards'],
  ['groomingCheck', 'Grooming'],
  ['registerCheck', 'Registers & books'],
  ['fireEqCheck', 'Fire extinguishers'],
  ['cctvCheck', 'CCTV'],
  ['alarmCheck', 'Alarm'],
  ['clientSatisfactionCheck', 'Client satisfied'],
  ['cleanlinessCheck', 'Cleanliness'],
  ['equipmentCheck', 'Equipment'],
  ['weaponsCheck', 'Weapons & ammunition']
];

export const summariseChecks = (row) => {
  const recorded = INSPECTION_CHECKS.filter(([key]) => row[key] !== null && row[key] !== undefined);
  const failed = recorded.filter(([key]) => !row[key]).map(([, label]) => label);
  return { total: recorded.length, passed: recorded.length - failed.length, failed };
};

const th = { padding: '12px 16px' };
const headRow = { borderBottom: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '11px', textTransform: 'none' };
const emptyBox = { padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' };

const statusBadge = (status) =>
  status === 'Closed' ? 'badge-success' : status === 'Escalated' ? 'badge-danger' : 'badge-warning';

/**
 * Incident register (SRS FR-9..13). `canManage` shows the escalate / close / reopen actions and
 * the audit-trail viewer (staff only; the server enforces this too). `onChanged` reloads the data.
 * Rows from a CLIENT account arrive without internal fields, so every optional column degrades.
 */
export const IncidentsTable = ({ incidents, canManage = false, onChanged, onOpen }) => {
  const [openAudit, setOpenAudit] = useState(null); // incidentId whose trail is expanded
  const [audit, setAudit] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  if (incidents.length === 0) return <div style={emptyBox}>No incidents reported for this scope yet.</div>;

  const run = async (incidentId, action) => {
    setBusyId(incidentId);
    setError(null);
    try {
      await action();
      if (onChanged) await onChanged();
      if (openAudit === incidentId) setAudit((await apiService.getIncidentAudit(incidentId)).audit || []);
    } catch (e) {
      setError(e.message || 'The change could not be saved');
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = (incident, status) => {
    let notes;
    if (status === 'Closed') {
      notes = window.prompt(`Closure notes for ${incident.incidentId} (required):`);
      if (notes === null) return;
      if (!notes.trim()) { setError('Closure notes are required to close an incident'); return; }
    }
    run(incident.incidentId, () => apiService.updateIncidentStatus(incident.incidentId, status, notes));
  };

  const toggleAudit = async (incidentId) => {
    if (openAudit === incidentId) { setOpenAudit(null); return; }
    setError(null);
    try {
      setAudit((await apiService.getIncidentAudit(incidentId)).audit || []);
      setOpenAudit(incidentId);
    } catch (e) {
      setError(e.message || 'Could not load the audit trail');
    }
  };

  const hasReporter = incidents.some((i) => i.reportedBy !== undefined);
  const columns = 7 + (hasReporter ? 1 : 0) + (canManage ? 1 : 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      {error && <div role="alert" style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--alarm)' }}>{error}</div>}
      <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
        <thead>
          <tr style={headRow}>
            <th style={th}>REF ID</th>
            <th style={th}>CATEGORY</th>
            <th style={th}>SEVERITY</th>
            <th style={th}>STATUS</th>
            <th style={th}>SITE</th>
            <th style={th}>DESCRIPTION</th>
            {hasReporter && <th style={th}>REPORTED BY</th>}
            <th style={th}>TIMESTAMP</th>
            {canManage && <th style={th}>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => {
            const closed = i.status === 'Closed';
            const busy = busyId === i.incidentId;
            return (
              <React.Fragment key={i.incidentId}>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ ...th, fontFamily: 'monospace', color: 'var(--brass-ink)', fontSize: '12px', fontWeight: '700' }}>
                    {onOpen
                      ? <button className="link-btn" style={{ fontFamily: 'monospace', fontSize: '12px', textAlign: 'left' }} onClick={() => onOpen(i.incidentId)}>{i.incidentId}</button>
                      : i.incidentId}
                  </td>
                  <td style={{ ...th, color: 'var(--ink-2)' }}>
                    {i.category}
                    {i.subType && <div style={{ fontSize: '11px', color: 'var(--dim)' }}>{i.subType}</div>}
                  </td>
                  <td style={th}>
                    <span className={`badge ${i.severity === 'Critical' || i.severity === 'High' ? 'badge-danger' : 'badge-warning'}`}>{i.severity}</span>
                  </td>
                  <td style={th}>
                    <span className={`badge ${statusBadge(i.status)}`}>{i.status}</span>
                    {closed && i.closureNotes && <div style={{ fontSize: '11px', color: 'var(--dim)', marginTop: '4px', maxWidth: '200px' }}>{i.closureNotes}</div>}
                  </td>
                  <td style={{ ...th, color: 'var(--ink-2)' }}>{i.siteName}</td>
                  <td style={{ ...th, color: 'var(--muted)', maxWidth: '320px' }}>{i.description}</td>
                  {hasReporter && <td style={{ ...th, color: 'var(--ink-2)', fontSize: '12px' }}>{i.reportedBy}</td>}
                  <td style={{ ...th, color: 'var(--dim)', fontSize: '11px' }}>{new Date(i.createdAt).toLocaleString()}</td>
                  {canManage && (
                    <td style={{ ...th, whiteSpace: 'nowrap' }}>
                      {closed ? (
                        <button className="btn-secondary" disabled={busy} onClick={() => changeStatus(i, 'Open & Investigating')} style={{ padding: '4px 8px', fontSize: '11px', marginRight: '6px' }}>Reopen</button>
                      ) : (
                        <>
                          {i.status !== 'Escalated' && (
                            <button className="btn-secondary" disabled={busy} onClick={() => changeStatus(i, 'Escalated')} style={{ padding: '4px 8px', fontSize: '11px', marginRight: '6px' }}>Escalate</button>
                          )}
                          <button className="btn-primary" disabled={busy} onClick={() => changeStatus(i, 'Closed')} style={{ padding: '4px 8px', fontSize: '11px', marginRight: '6px' }}>Close</button>
                        </>
                      )}
                      <button className="btn-secondary" onClick={() => toggleAudit(i.incidentId)} style={{ padding: '4px 8px', fontSize: '11px' }}>
                        {openAudit === i.incidentId ? 'Hide history' : 'History'}
                      </button>
                    </td>
                  )}
                </tr>
                {canManage && openAudit === i.incidentId && (
                  <tr style={{ background: 'var(--band)' }}>
                    <td colSpan={columns} style={{ padding: '10px 16px 14px 32px', fontSize: '12px', color: 'var(--muted)' }}>
                      {audit.length === 0 ? 'No changes recorded since this incident was reported.' : (
                        <ul style={{ margin: 0, paddingLeft: '16px' }}>
                          {audit.map((a, idx) => (
                            <li key={idx}>
                              {new Date(a.changedAt).toLocaleString()} — {a.changedBy} changed <strong>{a.field}</strong>
                              {a.oldValue !== null && a.oldValue !== '' ? ` from "${a.oldValue}"` : ''} to "{a.newValue}"
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** Site inspection register (SRS FR-15): rating, checks passed out of those recorded, and what failed. */
export const InspectionsTable = ({ inspections }) => {
  if (inspections.length === 0) return <div style={emptyBox}>No site inspections submitted for this scope yet.</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
        <thead>
          <tr style={headRow}>
            <th style={th}>REF ID</th>
            <th style={th}>SITE</th>
            <th style={th}>RATING</th>
            <th style={th}>CHECKS PASSED</th>
            <th style={th}>REMARKS</th>
            <th style={th}>INSPECTOR</th>
            <th style={th}>TIMESTAMP</th>
          </tr>
        </thead>
        <tbody>
          {inspections.map((n) => {
            const { passed, total, failed } = summariseChecks(n);
            return (
              <tr key={n.inspectionId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ ...th, fontFamily: 'monospace', color: 'var(--brass-ink)', fontSize: '12px', fontWeight: '700' }}>{n.inspectionId}</td>
                <td style={{ ...th, color: 'var(--ink-2)' }}>{n.siteName}</td>
                <td style={th}>
                  <span className={`badge ${n.siteRating === 'Poor' ? 'badge-danger' : n.siteRating === 'Average' ? 'badge-warning' : 'badge-success'}`}>{n.siteRating}</span>
                </td>
                <td style={{ ...th, fontWeight: '700', color: failed.length === 0 ? 'var(--cleared)' : 'var(--brass-ink)' }}>
                  {passed} / {total}
                  {failed.length > 0 && <div style={{ fontSize: '11px', fontWeight: '400', color: 'var(--alarm)' }}>Failed: {failed.join(', ')}</div>}
                </td>
                <td style={{ ...th, color: 'var(--muted)', maxWidth: '320px' }}>{n.remarks || '—'}</td>
                <td style={{ ...th, color: 'var(--ink-2)', fontSize: '12px' }}>{n.inspectorName}</td>
                <td style={{ ...th, color: 'var(--dim)', fontSize: '11px' }}>{new Date(n.createdAt).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
