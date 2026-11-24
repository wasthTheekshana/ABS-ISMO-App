import React, { useCallback, useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { apiService } from '../services/api';
import { useApp } from '../context/AppContext';
import { reportToCsv } from '../utils/csv';

const th = { padding: '10px 16px' };
const headRow = { borderBottom: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '11px', textTransform: 'none' };

const todayInColombo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());

const download = (report) => {
  const blob = new Blob([`﻿${reportToCsv(report)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${report.type}-${report.date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

/**
 * The eight daily reports (SRS FR-18). Live reports are scoped to the signed-in role; MD and GM can
 * also open the stored organisation-wide copy the nightly job made for a past date.
 */
export const ReportsPanel = () => {
  const { currentUser } = useApp();
  const canSeeArchive = ['MD', 'GM'].includes(currentUser.role);
  const [types, setTypes] = useState([]);
  const [type, setType] = useState('operations');
  const [date, setDate] = useState(todayInColombo());
  const [archived, setArchived] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiService.getReportTypes().then((r) => setTypes(r.types || [])).catch((e) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await apiService.getDailyReport(type, date, archived));
    } catch (e) {
      setReport(null);
      setError(e.message || 'Could not load the report');
    } finally {
      setLoading(false);
    }
  }, [type, date, archived]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
        <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          REPORT
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Report">
            {types.map((t) => <option key={t.type} value={t.type}>{t.title}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          DATE
          <input type="date" value={date} max={todayInColombo()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Report date" />
        </label>
        {canSeeArchive && (
          <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '6px' }}>
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Stored copy (organisation-wide)
          </label>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" disabled={!report || report.rows.length === 0} onClick={() => download(report)} style={{ padding: '6px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={14} /> CSV
          </button>
          <button className="btn-secondary" disabled={!report} onClick={() => window.print()} style={{ padding: '6px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alarm)' }}>{error}</div>}
      {loading && !report && <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Generating report...</div>}

      {report && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--rule)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--ink)' }}>{report.title}</h3>
            <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
              {report.date} · generated {new Date(report.generatedAt).toLocaleString()}
              {archived ? ' · stored organisation-wide copy' : ' · live, for your access scope'}
            </p>
          </div>
          {report.rows.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>Nothing to report for this date.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={headRow}>{report.columns.map((c) => <th key={c.key} style={th}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {report.rows.map((row, i) => {
                    const total = row.site === 'TOTAL';
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', fontWeight: total ? '800' : '400', background: total ? 'var(--brass-bg)' : undefined }}>
                        {report.columns.map((c) => (
                          <td key={c.key} style={{ ...th, color: total ? 'var(--brass-ink)' : 'var(--ink-2)', maxWidth: '360px' }}>{row[c.key] === null || row[c.key] === undefined ? '—' : String(row[c.key])}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
