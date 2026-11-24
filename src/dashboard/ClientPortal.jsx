import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, ClipboardCheck, MessageSquare } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiService } from '../services/api';
import { IncidentsTable, InspectionsTable } from './RecordTables';
import { ClientFeedbackForm, MyFeedbackList } from './ClientFeedbackForm';

/**
 * View for CLIENT accounts (SRS FR-16, FR-20): incidents and site inspections for the sites linked to
 * the account (read-only, internal detail removed by the server), and a form to give feedback about
 * the service, with the outcome of earlier feedback.
 */
export const ClientPortal = () => {
  const { currentUser, incidents, inspections } = useApp();
  const [tab, setTab] = useState('INCIDENTS');
  const [feedback, setFeedback] = useState([]);

  const loadFeedback = useCallback(async () => {
    try {
      setFeedback((await apiService.getFeedback()).feedback || []);
    } catch {
      setFeedback([]);
    }
  }, []);

  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  const tabButton = (key, icon, label) => (
    <button
      onClick={() => setTab(key)}
      className={`btn-secondary ${tab === key ? 'btn-primary' : ''}`}
      style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
    >
      {icon} {label}
    </button>
  );

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--ink)' }}>Welcome, {currentUser.name}</h2>
        <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
          Incidents and site inspections for your sites, and a place to tell us how we are doing. Contact AB Securitas operations for anything urgent.
        </p>
      </div>

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--rule)', flexWrap: 'wrap' }}>
          {tabButton('INCIDENTS', <ShieldAlert size={14} />, `Incidents (${incidents.length})`)}
          {tabButton('INSPECTIONS', <ClipboardCheck size={14} />, `Site inspections (${inspections.length})`)}
          {tabButton('FEEDBACK', <MessageSquare size={14} />, 'Give feedback')}
        </div>
        {tab === 'INCIDENTS' && <IncidentsTable incidents={incidents} />}
        {tab === 'INSPECTIONS' && <InspectionsTable inspections={inspections} />}
        {tab === 'FEEDBACK' && (
          <>
            <ClientFeedbackForm onSubmitted={loadFeedback} />
            <div style={{ borderTop: '1px solid var(--rule)' }}>
              <div style={{ padding: '12px 16px', fontSize: '13px', fontWeight: '700', color: 'var(--ink)' }}>Your earlier feedback</div>
              <MyFeedbackList feedback={feedback} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
