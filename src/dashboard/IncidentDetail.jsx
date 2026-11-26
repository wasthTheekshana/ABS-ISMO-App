import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, FileText, User, Clock, Tag, Gauge, CircleDot, Banknote, Eye, ListChecks, Siren } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiService } from '../services/api';
import { useNotesDialog } from './NotesDialog';

const statusBadge = (status) => (status === 'Closed' ? 'badge-success' : status === 'Escalated' ? 'badge-danger' : 'badge-warning');
const severityBadge = (s) => (s === 'Critical' || s === 'High' ? 'badge-danger' : s === 'Medium' ? 'badge-warning' : 'badge-info');

const FIELD_LABEL = {
  severity: 'Severity', description: 'Description', actionTaken: 'Action taken', witnessDetails: 'Witnesses',
  clientRepDetails: 'Client representative', policeNotified: 'Police notified', hospitalNotified: 'Hospital notified',
  fireNotified: 'Fire brigade notified', estimatedLoss: 'Estimated loss', status: 'Status', closureNotes: 'Closure notes'
};

const when = (value) => new Date(value).toLocaleString();

const Fact = ({ icon: Icon, label, children }) => (
  <div className="fact">
    <Icon size={16} aria-hidden="true" />
    <dt>{label}</dt>
    <dd>{children || 'None recorded'}</dd>
  </div>
);

const yes = (v) => (v ? 'Yes' : 'No');

/**
 * One incident: details, status actions and the full activity timeline (SRS FR-13, NFR-5).
 * The timeline is the incident's own audit trail, so it shows who changed what, and when.
 */
export const IncidentDetail = ({ incidentId, onBack }) => {
  const { incidents, refreshData } = useApp();
  const incident = incidents.find((i) => i.incidentId === incidentId);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [askForNotes, notesDialog] = useNotesDialog();

  const loadAudit = useCallback(async () => {
    try {
      setAudit((await apiService.getIncidentAudit(incidentId)).audit || []);
    } catch (e) {
      setError(e.message || 'Could not load the activity timeline');
    }
  }, [incidentId]);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  if (!incident) {
    return (
      <div className="page">
        <div className="crumbs"><button onClick={onBack}>Incidents</button><span>/</span><span>Not found</span></div>
        <p style={{ color: 'var(--muted)' }}>This incident is not in your scope, or it no longer exists.</p>
      </div>
    );
  }

  const closed = incident.status === 'Closed';

  const change = async (status) => {
    let notes;
    if (status === 'Closed') {
      notes = await askForNotes({
        title: 'Close incident',
        subject: `${incident.incidentId} · ${incident.siteName}`,
        label: 'Closure notes',
        confirmLabel: 'Close incident'
      });
      if (notes === null) return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiService.updateIncidentStatus(incident.incidentId, status, notes);
      await refreshData();
      await loadAudit();
    } catch (e) {
      setError(e.message || 'The change could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const entries = [
    { key: 'reported', open: true, title: 'Incident reported', by: `by ${incident.reportedBy}`, at: incident.createdAt },
    ...audit.map((a, i) => ({
      key: `a${i}`,
      open: a.field === 'status' && a.newValue !== 'Closed',
      title: a.field === 'status'
        ? `Status: ${a.newValue}`
        : `${FIELD_LABEL[a.field] || a.field} changed${a.oldValue ? ` from "${a.oldValue}"` : ''} to "${a.newValue}"`,
      by: `by ${a.changedBy}`,
      at: a.changedAt
    }))
  ];

  return (
    <div className="page">
      {notesDialog}
      <div className="crumbs">
        <button onClick={onBack}>Incidents</button><span>/</span><span>{incident.incidentId}</span>
      </div>

      <div className="detail-head">
        <div>
          <h1>{incident.incidentId}</h1>
          <div style={{ marginTop: '8px' }}>
            <span className={`badge ${statusBadge(incident.status)}`}>{incident.status}</span>
            <span className={`badge ${severityBadge(incident.severity)}`}>{incident.severity}</span>
          </div>
          <p style={{ color: 'var(--muted)', marginTop: '8px' }}>{incident.category} / {incident.subType}</p>
        </div>
        <div className="detail-actions">
          {closed ? (
            <button className="btn-secondary" disabled={busy} onClick={() => change('Open & Investigating')}>Reopen</button>
          ) : (
            <>
              {incident.status !== 'Escalated' && <button className="btn-secondary" disabled={busy} onClick={() => change('Escalated')}>Escalate</button>}
              <button className="btn-primary" disabled={busy} onClick={() => change('Closed')}>Close incident</button>
            </>
          )}
        </div>
      </div>

      {error && <div role="alert">{error}</div>}

      <div className="detail-grid">
        <section className="card" aria-labelledby="details-h">
          <h3 id="details-h">Incident details</h3>
          <dl className="facts">
            <Fact icon={MapPin} label="Site">{incident.siteName}</Fact>
            <Fact icon={FileText} label="Description">{incident.description}</Fact>
            <Fact icon={User} label="Reported by">{incident.reportedBy}</Fact>
            <Fact icon={Clock} label="Reported">{when(incident.createdAt)}</Fact>
            <Fact icon={ListChecks} label="Action taken">{incident.actionTaken}</Fact>
            <Fact icon={Eye} label="Witnesses">{incident.witnessDetails}</Fact>
            <Fact icon={User} label="Client representative">{incident.clientRepDetails}</Fact>
            <Fact icon={Banknote} label="Estimated loss">{Number(incident.estimatedLoss) > 0 ? `Rs ${Number(incident.estimatedLoss).toLocaleString()}` : ''}</Fact>
          </dl>
        </section>

        <section className="card" aria-labelledby="info-h">
          <h3 id="info-h">Incident information</h3>
          <dl className="facts">
            <Fact icon={Tag} label="Category">{incident.category}</Fact>
            <Fact icon={Gauge} label="Severity"><span className={`badge ${severityBadge(incident.severity)}`}>{incident.severity}</span></Fact>
            <Fact icon={CircleDot} label="Status"><span className={`badge ${statusBadge(incident.status)}`}>{incident.status}</span></Fact>
            <Fact icon={Siren} label="Services called">
              {`Police ${yes(incident.policeNotified)}, hospital ${yes(incident.hospitalNotified)}, fire brigade ${yes(incident.fireNotified)}`}
            </Fact>
            {closed && <Fact icon={FileText} label="Closure notes">{incident.closureNotes}</Fact>}
            {closed && <Fact icon={User} label="Closed by">{incident.closedBy}</Fact>}
          </dl>
        </section>
      </div>

      <section className="card" aria-labelledby="timeline-h">
        <h3 id="timeline-h">Activity timeline</h3>
        <ol className="timeline">
          {entries.map((e) => (
            <li key={e.key}>
              <span className={`pip ${e.open ? 'open' : 'closed'}`} aria-hidden="true" />
              <div><strong>{e.title}</strong><div className="by">{e.by}</div></div>
              <span className="when">{when(e.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};
