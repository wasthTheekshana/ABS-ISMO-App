import { Home, ShieldAlert, MapPin, FileText, ClipboardCheck, Layers, MessageSquare, TrendingDown, Radio } from 'lucide-react';

/**
 * Which sections of the web app each role sees, and which four sit in the phone tab bar.
 * The server enforces every one of these; hiding a section only stops a role being shown a screen
 * that would answer with an error. Roles: MD, GM, AGM, SM, VO, NVO, CONTROL_ROOM.
 */

const ALL = {
  board: { id: 'board', label: 'Control room', icon: Radio, roles: ['CONTROL_ROOM', 'MD', 'GM'] },
  home: { id: 'home', label: 'Overview', icon: Home },
  incidents: { id: 'incidents', label: 'Incidents', icon: ShieldAlert },
  field: { id: 'field', label: 'Field map', icon: MapPin, roles: ['MD', 'GM', 'AGM', 'SM', 'CONTROL_ROOM'] },
  reports: { id: 'reports', label: 'Reports', icon: FileText },
  absenteeism: { id: 'absenteeism', label: 'Absenteeism', icon: TrendingDown },
  audit: { id: 'audit', label: 'Field submissions', icon: Layers },
  inspections: { id: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  feedback: { id: 'feedback', label: 'Client feedback', icon: MessageSquare, roles: ['MD', 'GM', 'AGM', 'SM', 'CONTROL_ROOM'] }
};

const allowed = (section, role) => !section.roles || section.roles.includes(role);

/** Order shown in the wide-screen strip and the "More" sheet. */
const ORDER = ['board', 'home', 'incidents', 'field', 'reports', 'absenteeism', 'audit', 'inspections', 'feedback'];

/** The four sections that get a slot in the phone tab bar (the fifth slot is "More"). */
const PRIMARY = {
  CONTROL_ROOM: ['board', 'incidents', 'field', 'reports'],
  default: ['home', 'incidents', 'field', 'reports']
};

export const sectionsFor = (role) => {
  const sections = ORDER.map((id) => ALL[id]).filter((s) => allowed(s, role));
  const wanted = PRIMARY[role] ?? PRIMARY.default;
  const primary = wanted.map((id) => ALL[id]).filter((s) => allowed(s, role));
  const primaryIds = new Set(primary.map((s) => s.id));
  return { sections, primary, more: sections.filter((s) => !primaryIds.has(s.id)) };
};

/** Where each role lands after signing in. */
export const defaultSection = (role) => (role === 'CONTROL_ROOM' ? 'board' : 'home');
