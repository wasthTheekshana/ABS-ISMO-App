import React, { useMemo, useState } from 'react';
import { buildAttention } from '../utils/attention';

const INITIAL = 6;

const ACTION = {
  incident: { label: 'Open incidents', section: 'incidents' },
  staffing: { label: 'See sites', anchor: 'site-roster' },
  absence: { label: 'See submission', section: 'audit' }
};

/**
 * The first thing a manager sees: what needs doing now, in plain sentences, most urgent first.
 * Each line carries a rubber-stamp status and one action.
 */
export const NeedsAttention = ({ sites, incidents, absenceLogs, onGo }) => {
  const [showAll, setShowAll] = useState(false);
  const items = useMemo(() => buildAttention({ sites, incidents, absenceLogs }), [sites, incidents, absenceLogs]);

  if (items.length === 0) {
    return (
      <div className="attention-empty">
        <span className="badge badge-success">All clear</span>
        <p>
          Nothing needs attention right now.
          <small>Every site is fully staffed, no incident is open, and no absence today is without cover.</small>
        </p>
      </div>
    );
  }

  const shown = showAll ? items : items.slice(0, INITIAL);

  const go = (item) => {
    const action = ACTION[item.kind];
    if (action.section) onGo(action.section);
    else document.getElementById(action.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <ul className="attention" aria-label="Needs attention now">
        {shown.map((item) => (
          <li key={item.id}>
            <span><span className={`badge badge-${item.tone}`}>{item.stamp}</span></span>
            <div>
              <div className="what">{item.what}</div>
              <div className="why">{item.why}</div>
            </div>
            <button className="btn-secondary" onClick={() => go(item)}>{ACTION[item.kind].label}</button>
          </li>
        ))}
      </ul>
      {items.length > INITIAL && (
        <button className="btn-secondary" style={{ marginTop: '10px' }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
};
