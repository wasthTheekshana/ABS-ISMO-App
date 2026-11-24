import React from 'react';
import { useApp } from '../context/AppContext';
import { HomeView } from './HomeView';
import { AbsenteeismView } from './AbsenteeismView';
import { AuditView } from './AuditView';
import { InspectionsTable } from './RecordTables';
import { IncidentsView } from './IncidentsView';
import { IncidentDetail } from './IncidentDetail';
import { FieldMap } from './FieldMap';
import { ReportsPanel } from './ReportsPanel';
import { FeedbackPanel } from './FeedbackPanel';
import { ControlRoomBoard } from './ControlRoomBoard';

const Titled = ({ title, hint, children }) => (
  <div className="page">
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {hint && <p>{hint}</p>}
      </div>
    </div>
    {children}
  </div>
);

/** Shows the selected section of the web app. Navigation lives in App.jsx. */
export const ExecutiveDashboard = ({ section, onGo, incidentId, onOpenIncident, onBackToIncidents }) => {
  const { inspections } = useApp();

  switch (section) {
    case 'board':
      return <ControlRoomBoard />;
    case 'absenteeism':
      return <AbsenteeismView />;
    case 'audit':
      return <AuditView />;
    case 'incidents':
      return incidentId
        ? <IncidentDetail incidentId={incidentId} onBack={onBackToIncidents} />
        : <IncidentsView onOpen={onOpenIncident} />;
    case 'inspections':
      return (
        <Titled title="Site inspections" hint="Checklist results from Visiting Officers, with anything that failed.">
          <section className="panel"><InspectionsTable inspections={inspections} /></section>
        </Titled>
      );
    case 'field':
      return (
        <Titled title="Field map" hint="Where Visiting Officers are now, and the site visits for a day.">
          <FieldMap />
        </Titled>
      );
    case 'reports':
      return (
        <Titled title="Daily reports" hint="Eight reports for any day. Download a CSV or print.">
          <ReportsPanel />
        </Titled>
      );
    case 'feedback':
      return (
        <Titled title="Client feedback" hint="Ratings, complaints and suggestions from clients.">
          <FeedbackPanel />
        </Titled>
      );
    default:
      return <HomeView onGo={onGo} />;
  }
};
