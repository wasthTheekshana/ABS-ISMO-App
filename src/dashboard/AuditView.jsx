import React from 'react';
import { useApp } from '../context/AppContext';

/** Every absence and late report submitted from the field, newest first, with who submitted it. */
export const AuditView = () => {
  const { absenceLogs, lateLogs } = useApp();

  const entries = [
    ...absenceLogs.map((l) => ({ ...l, logType: 'Absence' })),
    ...lateLogs.map((l) => ({ ...l, logType: 'Late' }))
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Field submissions</h1>
          <p>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}: {absenceLogs.length} absences and {lateLogs.length} late reports.</p>
        </div>
      </div>

      <section className="panel">
        {entries.length === 0 ? (
          <p style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>No absences or late reports have been submitted yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="register">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Officer</th>
                  <th>Site</th>
                  <th>Details</th>
                  <th>Submitted by</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((log) => (
                  <tr key={log.logId}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12px' }}>{log.logId}</td>
                    <td><span className={`badge ${log.logType === 'Absence' ? 'badge-danger' : 'badge-warning'}`}>{log.logType}</span></td>
                    <td style={{ fontWeight: 600 }}>{log.officerName} ({log.epf})</td>
                    <td>{log.siteName}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {log.logType === 'Absence'
                        ? `${log.reason}. Replacement sent: ${log.replacementDeployed ? 'yes' : 'no'}.`
                        : `${log.delayMinutes} min late. Scheduled ${log.scheduledTime}, arrived ${log.actualTime}.`}
                    </td>
                    <td style={{ fontSize: '13px' }}>{log.submittedBy}</td>
                    <td style={{ color: 'var(--muted)', fontSize: '12px' }}>{new Date(log.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
