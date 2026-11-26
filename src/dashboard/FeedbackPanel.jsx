import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useNotesDialog } from './NotesDialog';

const th = { padding: '10px 16px' };
const headRow = { borderBottom: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '11px', textTransform: 'none' };

export const Stars = ({ value }) => (
  <span aria-label={`${value} out of 5`} style={{ color: 'var(--brass-ink)', letterSpacing: '2px', whiteSpace: 'nowrap' }}>
    {'★'.repeat(value)}<span style={{ color: 'var(--rule-strong)' }}>{'☆'.repeat(5 - value)}</span>
  </span>
);

const statusBadge = (status) => (status === 'Resolved' ? 'badge-success' : status === 'Acknowledged' ? 'badge-warning' : 'badge-danger');

const average = (rows, key) => (rows.length === 0 ? null : rows.reduce((s, r) => s + r[key], 0) / rows.length);
const fmt = (n) => (n === null ? '—' : n.toFixed(1));

const Tile = ({ label, value, tone }) => (
  <div className="tile" style={{ '--tone': tone }}>
    <div className="label">{label}</div>
    <div className="numeral">{value}</div>
  </div>
);

/**
 * Client feedback for management (SRS FR-16): ratings, complaints and suggestions, with
 * Acknowledge / Resolve (notes required) / Reopen. The server enforces who may act and on which sites.
 */
export const FeedbackPanel = () => {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('ALL'); // ALL | COMPLAINTS | OPEN
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [askForNotes, notesDialog] = useNotesDialog();

  const load = useCallback(async () => {
    try {
      setRows((await apiService.getFeedback()).feedback || []);
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not load client feedback');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const change = async (item, status) => {
    let notes;
    if (status === 'Resolved') {
      notes = await askForNotes({
        title: 'Resolve feedback',
        subject: `${item.siteName} · ${item.clientName}`,
        label: 'Resolution notes',
        confirmLabel: 'Mark resolved'
      });
      if (notes === null) return;
    }
    setBusyId(item.feedbackId);
    setError(null);
    try {
      await apiService.updateFeedbackStatus(item.feedbackId, status, notes);
      await load();
    } catch (e) {
      setError(e.message || 'The change could not be saved');
    } finally {
      setBusyId(null);
    }
  };

  const openComplaints = rows.filter((r) => r.isComplaint && r.status !== 'Resolved').length;
  const shown = rows.filter((r) =>
    filter === 'COMPLAINTS' ? r.isComplaint : filter === 'OPEN' ? r.status !== 'Resolved' : true);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
      {notesDialog}
      <div className="tiles">
        <Tile label="Responses" value={rows.length} tone="var(--info)" />
        <Tile label="Average overall" value={fmt(average(rows, 'overallRating'))} tone="var(--brass-ink)" />
        <Tile label="Punctuality" value={fmt(average(rows, 'punctuality'))} tone="var(--cleared)" />
        <Tile label="Discipline" value={fmt(average(rows, 'discipline'))} tone="var(--cleared)" />
        <Tile label="Grooming" value={fmt(average(rows, 'grooming'))} tone="var(--cleared)" />
        <Tile label="Communication" value={fmt(average(rows, 'communication'))} tone="var(--cleared)" />
        <Tile label="Open complaints" value={openComplaints} tone={openComplaints > 0 ? 'var(--alarm)' : 'var(--cleared)'} />
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[['ALL', 'All'], ['COMPLAINTS', 'Complaints'], ['OPEN', 'Not yet resolved']].map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} className={`btn-secondary ${filter === key ? 'btn-primary' : ''}`} style={{ padding: '6px 12px', fontSize: '12px' }}>{label}</button>
        ))}
      </div>

      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alarm)' }}>{error}</div>}

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {!loaded ? (
          <div style={{ padding: '20px', color: 'var(--muted)', fontSize: '12px' }}>Loading client feedback...</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>No client feedback to show.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={headRow}>
                  <th style={th}>RECEIVED</th><th style={th}>SITE / CLIENT</th><th style={th}>OVERALL</th><th style={th}>P · D · G · C</th>
                  <th style={th}>COMMENTS</th><th style={th}>STATUS</th><th style={th}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const busy = busyId === f.feedbackId;
                  return (
                    <tr key={f.feedbackId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
                      <td style={{ ...th, color: 'var(--dim)', fontSize: '11px' }}>{new Date(f.createdAt).toLocaleString()}</td>
                      <td style={{ ...th, color: 'var(--ink-2)' }}>{f.siteName}<div style={{ fontSize: '11px', color: 'var(--dim)' }}>{f.clientName}</div></td>
                      <td style={th}><Stars value={f.overallRating} /></td>
                      <td style={{ ...th, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{f.punctuality} · {f.discipline} · {f.grooming} · {f.communication}</td>
                      <td style={{ ...th, maxWidth: '340px' }}>
                        {f.complaints && <div style={{ color: 'var(--alarm)' }}><strong>Complaint:</strong> {f.complaints}</div>}
                        {f.suggestions && <div style={{ color: 'var(--muted)' }}><strong>Suggestion:</strong> {f.suggestions}</div>}
                        {!f.complaints && !f.suggestions && <span style={{ color: 'var(--dim)' }}>—</span>}
                        {f.resolutionNotes && <div style={{ color: 'var(--cleared)', marginTop: '4px', fontSize: '12px' }}>Resolved: {f.resolutionNotes}</div>}
                      </td>
                      <td style={th}><span className={`badge ${statusBadge(f.status)}`}>{f.status}</span></td>
                      <td style={{ ...th, whiteSpace: 'nowrap' }}>
                        {f.status === 'New' && <button className="btn-secondary" disabled={busy} onClick={() => change(f, 'Acknowledged')} style={{ padding: '4px 8px', fontSize: '11px', marginRight: '6px' }}>Acknowledge</button>}
                        {f.status !== 'Resolved' && <button className="btn-primary" disabled={busy} onClick={() => change(f, 'Resolved')} style={{ padding: '4px 8px', fontSize: '11px' }}>Resolve</button>}
                        {f.status === 'Resolved' && <button className="btn-secondary" disabled={busy} onClick={() => change(f, 'New')} style={{ padding: '4px 8px', fontSize: '11px' }}>Reopen</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
