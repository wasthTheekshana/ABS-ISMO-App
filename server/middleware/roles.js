/**
 * Single source of truth for which role may do what (SRS FR-4, FR-5, FR-9..15, FR-20).
 * Use with requireRole(...LIST) from security.js. Site visibility is separate and lives
 * in scope.js (siteScope); a role must pass BOTH to touch a record.
 *
 * Roles: MD, GM, AGM, SM, VO, NVO, CONTROL_ROOM (staff) · SECURITY_GUARD · CLIENT
 */

/** Everyone who works for AB Securitas on the management / field-officer side. */
export const STAFF_ROLES = ['MD', 'GM', 'AGM', 'SM', 'VO', 'NVO', 'CONTROL_ROOM'];

/** The site roster: staff, plus guards (scoped to the one site they are posted to) so they can file reports. */
export const SITE_READ_ROLES = [...STAFF_ROLES, 'SECURITY_GUARD'];

/** FR-4 / FR-5: log guard absence and late reporting. */
export const ATTENDANCE_LOGGING_ROLES = ['VO', 'NVO', 'SM', 'CONTROL_ROOM'];

/** FR-15: perform a site inspection. */
export const INSPECTION_SUBMIT_ROLES = ['VO', 'NVO', 'SM'];

/** FR-9..12 / UC-3: report an incident (guards report for their own site). */
export const INCIDENT_REPORT_ROLES = [...STAFF_ROLES, 'SECURITY_GUARD'];

/** FR-14: record arrival, departure and location while on a site round. */
export const VISIT_ROLES = ['VO', 'NVO'];

/**
 * FR-8: who may see live officer locations. NVO locations are restricted to MD and GM
 * (NVO_LOCATION_ROLES); everyone else on the map sees Visiting Officers only.
 */
export const LIVE_MAP_ROLES = ['MD', 'GM', 'AGM', 'SM', 'CONTROL_ROOM'];
export const NVO_LOCATION_ROLES = ['MD', 'GM'];

/** FR-18: read the daily reports. */
export const REPORT_ROLES = STAFF_ROLES;

/**
 * FR-16: only clients give feedback. Management reads and handles it (field officers do not
 * see client complaints); a client reads only their own submissions.
 */
export const FEEDBACK_SUBMIT_ROLES = ['CLIENT'];
export const FEEDBACK_MANAGE_ROLES = ['MD', 'GM', 'AGM', 'SM', 'CONTROL_ROOM'];
export const FEEDBACK_READ_ROLES = [...FEEDBACK_MANAGE_ROLES, ...FEEDBACK_SUBMIT_ROLES];

/** The live operations board: Control Room works from it, MD and GM may watch it. */
export const CONTROL_ROOM_BOARD_ROLES = ['CONTROL_ROOM', 'MD', 'GM'];

/** Edit, escalate or close an incident, and read its audit trail. */
export const INCIDENT_MANAGE_ROLES = STAFF_ROLES;

/** Read incidents: staff see their scope, guards only their own reports, clients their sites (redacted). */
export const INCIDENT_READ_ROLES = [...STAFF_ROLES, 'SECURITY_GUARD', 'CLIENT'];

/** Read inspections: staff, and clients for their own sites. */
export const INSPECTION_READ_ROLES = [...STAFF_ROLES, 'CLIENT'];
