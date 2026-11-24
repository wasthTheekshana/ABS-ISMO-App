import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { Stars } from './FeedbackPanel';

const RATINGS = [
  ['punctuality', 'Punctuality'],
  ['discipline', 'Discipline'],
  ['grooming', 'Grooming and turnout'],
  ['communication', 'Communication']
];

const statusBadge = (status) => (status === 'Resolved' ? 'badge-success' : status === 'Acknowledged' ? 'badge-warning' : 'badge-danger');

const StarInput = ({ label, value, onChange }) => (
  <div role="radiogroup" aria-label={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
    <span style={{ minWidth: '170px', fontSize: '13px', color: 'var(--ink-2)' }}>{label}</span>
    <span style={{ display: 'flex', gap: '2px' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(n)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', lineHeight: 1, padding: '2px 3px', color: n <= value ? 'var(--brass-ink)' : 'var(--rule-strong)' }}
        >
          {n <= value ? '★' : '☆'}
        </button>
      ))}
    </span>
  </div>
);

/**
 * Client feedback form (SRS FR-16): ratings for punctuality, discipline, grooming and communication,
 * an overall star rating, complaints and suggestions, optionally about one recent site visit.
 */
export const ClientFeedbackForm = ({ onSubmitted }) => {
  const [sites, setSites] = useState([]);
  const [visits, setVisits] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [visitId, setVisitId] = useState('');
  const [ratings, setRatings] = useState({ punctuality: 0, discipline: 0, grooming: 0, communication: 0, overallRating: 0 });
  const [complaints, setComplaints] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const loadChoices = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([apiService.getFeedbackSites(), apiService.getFeedbackVisits()]);
      setSites(s.sites || []);
      setVisits(v.visits || []);
      setSiteId((current) => current || s.sites?.[0]?.siteId || '');
    } catch (e) {
      setError(e.message || 'Could not load your sites');
    }
  }, []);

  useEffect(() => { loadChoices(); }, [loadChoices]);

  const rateable = visits.filter((v) => v.siteId === siteId && !v.hasFeedback);
  const incomplete = Object.values(ratings).some((n) => n === 0);

  const submit = async (e) => {
    e.preventDefault();
    if (incomplete) { setError('Please give every rating, including the overall rating.'); return; }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiService.submitFeedback({ siteId, visitId: visitId || undefined, ...ratings, complaints, suggestions });
      setDone(res.message);
      setRatings({ punctuality: 0, discipline: 0, grooming: 0, communication: 0, overallRating: 0 });
      setComplaints('');
      setSuggestions('');
      setVisitId('');
      await loadChoices();
      if (onSubmitted) await onSubmitted();
    } catch (err) {
      setError(err.message || 'Your feedback could not be sent');
    } finally {
      setBusy(false);
    }
  };

  if (sites.length === 0 && !error) {
    return <div style={{ padding: '20px', color: 'var(--muted)', fontSize: '13px' }}>No sites are linked to your account yet.</div>;
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', maxWidth: '640px' }}>
      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        SITE
        <select value={siteId} onChange={(e) => { setSiteId(e.target.value); setVisitId(''); }} aria-label="Site">
          {sites.map((s) => <option key={s.siteId} value={s.siteId}>{s.name}</option>)}
        </select>
      </label>

      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        ABOUT A RECENT VISIT (OPTIONAL)
        <select value={visitId} onChange={(e) => setVisitId(e.target.value)} aria-label="Visit">
          <option value="">General feedback, no specific visit</option>
          {rateable.map((v) => (
            <option key={v.visitId} value={v.visitId}>
              {new Date(v.arrivedAt).toLocaleString()} · {v.officerName}
            </option>
          ))}
        </select>
      </label>

      {RATINGS.map(([key, label]) => (
        <StarInput key={key} label={label} value={ratings[key]} onChange={(n) => setRatings((r) => ({ ...r, [key]: n }))} />
      ))}
      <StarInput label="Overall rating" value={ratings.overallRating} onChange={(n) => setRatings((r) => ({ ...r, overallRating: n }))} />

      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        COMPLAINTS (OPTIONAL)
        <textarea value={complaints} onChange={(e) => setComplaints(e.target.value)} rows={3} maxLength={2000} placeholder="Tell us what went wrong" aria-label="Complaints" />
      </label>
      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        SUGGESTIONS (OPTIONAL)
        <textarea value={suggestions} onChange={(e) => setSuggestions(e.target.value)} rows={3} maxLength={2000} placeholder="How could we serve you better?" aria-label="Suggestions" />
      </label>

      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alarm)' }}>{error}</div>}
      {done && <div role="status" style={{ fontSize: '13px', color: 'var(--cleared)' }}>{done}</div>}

      <button type="submit" className="btn-primary" disabled={busy || !siteId} style={{ padding: '10px 16px', alignSelf: 'flex-start' }}>
        {busy ? 'Sending...' : 'Send feedback'}
      </button>
    </form>
  );
};

/** The client's own past feedback, with what management did about it. */
export const MyFeedbackList = ({ feedback }) => {
  if (feedback.length === 0) return <div style={{ padding: '20px', color: 'var(--muted)', fontSize: '12px', textAlign: 'center' }}>You have not sent any feedback yet.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {feedback.map((f) => (
        <div key={f.feedbackId} style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--ink-2)', fontWeight: '600' }}>{f.siteName}</span>
            <span className={`badge ${statusBadge(f.status)}`}>{f.status}</span>
          </div>
          <div style={{ marginTop: '4px' }}><Stars value={f.overallRating} /> <span style={{ fontSize: '11px', color: 'var(--dim)' }}>{new Date(f.createdAt).toLocaleString()}</span></div>
          {f.complaints && <div style={{ color: 'var(--alarm)', fontSize: '13px', marginTop: '6px' }}>Complaint: {f.complaints}</div>}
          {f.suggestions && <div style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '4px' }}>Suggestion: {f.suggestions}</div>}
          {f.resolutionNotes && <div style={{ color: 'var(--cleared)', fontSize: '13px', marginTop: '6px' }}>AB Securitas replied: {f.resolutionNotes}</div>}
        </div>
      ))}
    </div>
  );
};
