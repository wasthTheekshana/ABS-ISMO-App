import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { IncidentsTable } from './RecordTables';

const CATEGORIES = ['Operational', 'Security', 'Safety', 'Medical'];
const STATUSES = ['Open & Investigating', 'Escalated', 'Closed'];

/** Incident register: search, filter by category and status, open one for its detail page. */
export const IncidentsView = ({ onOpen }) => {
  const { incidents, refreshData } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState('ALL');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents.filter((i) =>
      (category === 'ALL' || i.category === category)
      && (status === 'ALL' || i.status === status)
      && (!q || [i.incidentId, i.siteName, i.description, i.subType, i.reportedBy].some((v) => String(v || '').toLowerCase().includes(q))));
  }, [incidents, query, category, status]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Incidents</h1>
          <p>Open an incident to escalate or close it, and to see every change made to it.</p>
        </div>
      </div>

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by reference, site or description" aria-label="Search incidents" />
          </div>
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="ALL">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {shown.length === 0 && incidents.length > 0 ? (
          <p style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>No incident matches these filters. Clear the search or choose "All".</p>
        ) : (
          <IncidentsTable incidents={shown} canManage onChanged={refreshData} onOpen={onOpen} />
        )}
      </section>
    </div>
  );
};
