/**
 * OpenAPI 3.0 description of the ISOMS REST API, served as Swagger UI at /api/docs.
 * Written by hand from the route files: when a route's fields or roles change, update it here.
 * A test (server/tests/docs.test.js) checks that every mounted route is documented.
 */

const STAFF = 'MD, GM, AGM, SM, VO, NVO, CONTROL_ROOM';
const bearer = [{ bearerAuth: [] }];

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const body = (schema, required = true) => ({ required, content: json(schema) });
const ok = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const err = (description) => ({ description, content: json(ref('Error')) });

const R401 = err('Missing, malformed or expired token');
const R403 = err('Role not allowed, site outside the caller\'s scope, or the initial passcode has not been changed yet');
const R400 = err('Invalid or missing fields');

const idParam = (what) => ({ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: what });
const query = (name, description, schema = { type: 'string' }) => ({ name, in: 'query', required: false, description, schema });
const dateQuery = (name, description) => query(name, description, { type: 'string', format: 'date', example: '2026-11-26' });

/** Protected operation: adds the token, 401 and 403 responses and a roles line to the description. */
const op = (tag, summary, roles, config) => ({
  tags: [tag],
  summary,
  security: bearer,
  ...config,
  description: `${config.description ? `${config.description}\n\n` : ''}**Roles:** ${roles}`,
  responses: { ...config.responses, 401: R401, 403: R403 }
});

const list = (key) => ({ type: 'object', properties: { [key]: { type: 'array', items: { type: 'object' } } } });

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'AB Securitas ISOMS API',
    version: '1.0.0',
    description: [
      'REST API behind the ISOMS web dashboard and the Flutter field app.',
      '',
      '**How to try it**',
      '1. Call `POST /api/auth/login` with an EPF number and passcode.',
      '2. Copy the `token` from the response, press **Authorize** and paste it (without the word Bearer).',
      '3. A new account must first call `POST /api/auth/change-password`. Until then every other route answers 403 `PASSWORD_CHANGE_REQUIRED`.',
      '',
      '**Scope.** Besides the role, most routes only return or accept records for sites the caller is assigned to (MD and GM see everything, a guard sees one site, a client sees their own sites).',
      '',
      'Errors are `{ "error": "message" }`. Unexpected server failures return 500 with no internal detail.'
    ].join('\n')
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Auth', description: 'Sign in, profile and passcode change' },
    { name: 'Dashboard', description: 'Executive KPIs, sites, officers and the Control Room board' },
    { name: 'Attendance', description: 'Guard shifts, absence and late reporting' },
    { name: 'Incidents', description: 'Incident reporting and the manager workflow' },
    { name: 'Inspections', description: 'Site inspections' },
    { name: 'Visits', description: 'Site visits by field officers, GPS pings and the live map' },
    { name: 'Feedback', description: 'Client feedback on officer visits' },
    { name: 'Reports', description: 'Daily reports and the nightly archive' },
    { name: 'System', description: 'Health check' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token from POST /api/auth/login (valid 12 hours).' }
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      Role: { type: 'string', enum: ['MD', 'GM', 'AGM', 'SM', 'VO', 'NVO', 'CONTROL_ROOM', 'SECURITY_GUARD', 'CLIENT'] },
      User: {
        type: 'object',
        properties: {
          epf: { type: 'string', example: 'EPF-1042' }, name: { type: 'string' }, role: ref('Role'),
          title: { type: 'string' }, region: { type: 'string' }, sector: { type: 'string' },
          mustChangePassword: { type: 'boolean' }
        }
      },
      LoginRequest: {
        type: 'object', required: ['epf', 'password'],
        properties: { epf: { type: 'string', example: 'EPF-1042' }, password: { type: 'string', format: 'password' } }
      },
      LoginResponse: {
        type: 'object',
        properties: { message: { type: 'string' }, token: { type: 'string' }, user: ref('User') }
      },
      ChangePasswordRequest: {
        type: 'object', required: ['currentPassword', 'newPassword'],
        properties: { currentPassword: { type: 'string', format: 'password' }, newPassword: { type: 'string', format: 'password' } }
      },
      Shift: { type: 'string', example: 'Day', description: 'Shift name as used by the apps, for example Day or Night.' },
      AbsenceRequest: {
        type: 'object', required: ['epf', 'officerName', 'siteId', 'siteName', 'date', 'shift', 'reason'],
        properties: {
          epf: { type: 'string', description: 'The absent guard' }, officerName: { type: 'string' },
          siteId: { type: 'string' }, siteName: { type: 'string' }, date: { type: 'string', format: 'date' },
          shift: ref('Shift'), reason: { type: 'string' }, replacementEpf: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true }
        }
      },
      LateRequest: {
        type: 'object', required: ['epf', 'officerName', 'siteId', 'siteName', 'date', 'shift', 'scheduledTime', 'actualTime', 'reason'],
        properties: {
          epf: { type: 'string' }, officerName: { type: 'string' }, siteId: { type: 'string' }, siteName: { type: 'string' },
          date: { type: 'string', format: 'date' }, shift: ref('Shift'),
          scheduledTime: { type: 'string', example: '06:00' }, actualTime: { type: 'string', example: '06:40' },
          delayMinutes: { type: 'integer', description: 'Optional; worked out from the two times when omitted' },
          reason: { type: 'string' }, remarks: { type: 'string', nullable: true }
        }
      },
      CheckInRequest: {
        type: 'object', required: ['epf', 'siteId', 'shift'],
        properties: {
          epf: { type: 'string', description: 'Must be the caller\'s own EPF' }, siteId: { type: 'string' },
          shift: ref('Shift'), gpsLat: { type: 'number' }, gpsLng: { type: 'number' }
        }
      },
      IncidentReport: {
        type: 'object', required: ['category', 'subType', 'siteId', 'siteName', 'description'],
        properties: {
          category: { type: 'string', enum: ['Operational', 'Security', 'Safety', 'Medical'] },
          subType: { type: 'string' },
          severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
          siteId: { type: 'string' }, siteName: { type: 'string' }, description: { type: 'string' },
          gpsLat: { type: 'number', minimum: -90, maximum: 90 }, gpsLng: { type: 'number', minimum: -180, maximum: 180 },
          photoUrls: { type: 'array', items: { type: 'string' }, description: 'Photos as data URLs; the whole request is limited to 5 MB' },
          witnessDetails: { type: 'string' }, clientRepDetails: { type: 'string' }, actionTaken: { type: 'string' },
          policeNotified: { type: 'boolean' }, hospitalNotified: { type: 'boolean' }, fireNotified: { type: 'boolean' },
          estimatedLoss: { type: 'number', minimum: 0 }
        }
      },
      IncidentEdit: {
        type: 'object', minProperties: 1,
        description: 'Send at least one field. A closed incident must be reopened first.',
        properties: {
          severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] }, description: { type: 'string' },
          actionTaken: { type: 'string' }, witnessDetails: { type: 'string' }, clientRepDetails: { type: 'string' },
          policeNotified: { type: 'boolean' }, hospitalNotified: { type: 'boolean' }, fireNotified: { type: 'boolean' },
          estimatedLoss: { type: 'number', minimum: 0 }
        }
      },
      IncidentStatusChange: {
        type: 'object', required: ['status'],
        properties: {
          status: { type: 'string', enum: ['Open & Investigating', 'Escalated', 'Closed'] },
          closureNotes: { type: 'string', description: 'Required when closing' }
        }
      },
      InspectionSubmit: {
        type: 'object', required: ['siteId', 'siteName', 'siteRating'],
        properties: {
          siteId: { type: 'string' }, siteName: { type: 'string' },
          siteRating: { type: 'string', enum: ['Excellent', 'Good', 'Average', 'Poor'] },
          remarks: { type: 'string' },
          uniformCheck: { type: 'boolean' }, idCheck: { type: 'boolean' }, registerCheck: { type: 'boolean' },
          cctvCheck: { type: 'boolean' }, fireEqCheck: { type: 'boolean' },
          presenceCheck: { type: 'boolean', nullable: true }, groomingCheck: { type: 'boolean', nullable: true },
          alarmCheck: { type: 'boolean', nullable: true }, clientSatisfactionCheck: { type: 'boolean', nullable: true },
          cleanlinessCheck: { type: 'boolean', nullable: true }, equipmentCheck: { type: 'boolean', nullable: true },
          weaponsCheck: { type: 'boolean', nullable: true }
        }
      },
      ArriveRequest: {
        type: 'object', required: ['siteId', 'lat', 'lng'],
        properties: {
          siteId: { type: 'string' }, lat: { type: 'number', minimum: -90, maximum: 90 },
          lng: { type: 'number', minimum: -180, maximum: 180 }
        }
      },
      DepartRequest: {
        type: 'object',
        properties: {
          lat: { type: 'number' }, lng: { type: 'number' },
          notes: { type: 'string', description: 'Visit notes' }
        }
      },
      PingRequest: {
        type: 'object', required: ['lat', 'lng'],
        properties: {
          lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 },
          accuracy: { type: 'number', minimum: 0, description: 'Metres' }
        }
      },
      FeedbackSubmit: {
        type: 'object', required: ['siteId', 'punctuality', 'discipline', 'grooming', 'communication', 'overallRating'],
        properties: {
          siteId: { type: 'string' }, visitId: { type: 'string', nullable: true, description: 'One feedback per visit' },
          punctuality: { type: 'integer', minimum: 1, maximum: 5 }, discipline: { type: 'integer', minimum: 1, maximum: 5 },
          grooming: { type: 'integer', minimum: 1, maximum: 5 }, communication: { type: 'integer', minimum: 1, maximum: 5 },
          overallRating: { type: 'integer', minimum: 1, maximum: 5 },
          complaints: { type: 'string', description: 'Up to 2000 characters. Any text makes it a complaint.' },
          suggestions: { type: 'string', description: 'Up to 2000 characters' }
        }
      },
      FeedbackStatusChange: {
        type: 'object', required: ['status'],
        properties: {
          status: { type: 'string', enum: ['New', 'Acknowledged', 'Resolved'] },
          resolutionNotes: { type: 'string', description: 'Required when resolving' }
        }
      },
      Message: { type: 'object', properties: { message: { type: 'string' } } }
    }
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['System'], summary: 'Health check', description: 'No sign-in needed. Used by the container healthcheck and uptime monitor.',
        responses: {
          200: ok('API is running', {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'HEALTHY' }, system: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' }, environment: { type: 'string' }
            }
          })
        }
      }
    },

    '/api/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Sign in',
        description: 'Limited to 10 attempts per 15 minutes per client address. If `user.mustChangePassword` is true the token only works for `/api/auth/me` and `/api/auth/change-password`.',
        requestBody: body(ref('LoginRequest')),
        responses: { 200: ok('Signed in', ref('LoginResponse')), 400: R400, 401: err('Wrong EPF number or passcode'), 429: err('Too many attempts') }
      }
    },
    '/api/auth/me': {
      get: op('Auth', 'Current profile', 'any signed-in user', {
        responses: { 200: ok('Profile', { type: 'object', properties: { user: ref('User') } }) }
      })
    },
    '/api/auth/change-password': {
      post: op('Auth', 'Change passcode', 'any signed-in user, including a session that must change its passcode', {
        description: 'Returns a fresh token that no longer carries the must-change restriction. The initial shared passcode cannot be chosen again. Limited to 10 attempts per 15 minutes.',
        requestBody: body(ref('ChangePasswordRequest')),
        responses: {
          200: ok('Changed', { type: 'object', properties: { message: { type: 'string' }, token: { type: 'string' }, user: ref('User') } }),
          400: err('New passcode does not meet the rules'), 429: err('Too many attempts')
        }
      })
    },

    '/api/kpis/executive': {
      get: op('Dashboard', 'Executive KPIs', STAFF, {
        description: 'Totals for the caller\'s scope: incidents, attendance, inspections, visits and client feedback. Without `from` and `to` it covers the default period.',
        parameters: [dateQuery('from', 'Start date. Send together with `to`.'), dateQuery('to', 'End date. At most 366 days after `from`.')],
        responses: { 200: ok('KPI figures'), 400: R400 }
      })
    },
    '/api/sites': {
      get: op('Dashboard', 'Sites in scope', `${STAFF}, SECURITY_GUARD`, {
        description: 'The site roster. Guards see only the site they are posted to.',
        responses: { 200: ok('Sites', list('sites')) }
      })
    },
    '/api/officers': {
      get: op('Dashboard', 'Guards at sites in scope', STAFF, {
        responses: {
          200: ok('Guards', {
            type: 'object',
            properties: {
              officers: {
                type: 'array',
                items: { type: 'object', properties: { epf: { type: 'string' }, name: { type: 'string' }, rank: { type: 'string' }, siteId: { type: 'string' } } }
              }
            }
          })
        }
      })
    },
    '/api/control-room/board': {
      get: op('Dashboard', 'Live operations board', 'CONTROL_ROOM, MD, GM', {
        description: 'Open incidents, on-duty counts, visits in progress and the day\'s exceptions for the caller\'s scope.',
        responses: { 200: ok('Board data') }
      })
    },

    '/api/attendance/mine': {
      get: op('Attendance', 'My open shift and recent history', 'any signed-in user', {
        responses: { 200: ok('Open shift (if any) and history') }
      })
    },
    '/api/attendance/check-in': {
      post: op('Attendance', 'Start a shift', 'any signed-in user, for their own EPF only', {
        requestBody: body(ref('CheckInRequest')),
        responses: { 201: ok('Checked in'), 400: R400, 409: err('A shift is already open') }
      })
    },
    '/api/attendance/check-out': {
      post: op('Attendance', 'End a shift', 'any signed-in user', {
        requestBody: body({ type: 'object', required: ['recordId'], properties: { recordId: { type: 'integer' } } }),
        responses: { 200: ok('Checked out', ref('Message')), 400: R400, 404: err('No matching open shift') }
      })
    },
    '/api/absence/logs': {
      get: op('Attendance', 'Absence log', STAFF, { responses: { 200: ok('Absence entries', list('absenceLogs')) } })
    },
    '/api/absence/log': {
      post: op('Attendance', 'Log a guard absence', 'VO, NVO, SM, CONTROL_ROOM', {
        description: 'One entry per guard, date and shift. A duplicate returns 409 and includes the existing record only when its site is in the caller\'s scope.',
        requestBody: body(ref('AbsenceRequest')),
        responses: { 201: ok('Logged'), 400: R400, 409: err('Already logged for that guard, date and shift') }
      })
    },
    '/api/late/logs': {
      get: op('Attendance', 'Late-arrival log', STAFF, { responses: { 200: ok('Late entries', list('lateLogs')) } })
    },
    '/api/late/log': {
      post: op('Attendance', 'Log a late arrival', 'VO, NVO, SM, CONTROL_ROOM', {
        description: 'One entry per guard, date and shift, same duplicate rule as absences.',
        requestBody: body(ref('LateRequest')),
        responses: { 201: ok('Logged'), 400: R400, 409: err('Already logged for that guard, date and shift') }
      })
    },

    '/api/incidents/list': {
      get: op('Incidents', 'List incidents', `${STAFF}, SECURITY_GUARD, CLIENT`, {
        description: 'Staff see their scope, guards only their own reports, clients their sites with internal detail removed (no GPS, witnesses, loss or photos).',
        parameters: [query('category', 'Operational, Security, Safety or Medical'), query('siteId', 'Only this site')],
        responses: { 200: ok('Incidents', list('incidents')) }
      })
    },
    '/api/incidents/report': {
      post: op('Incidents', 'Report an incident', `${STAFF}, SECURITY_GUARD`, {
        description: 'The reporter is always the signed-in user.',
        requestBody: body(ref('IncidentReport')),
        responses: { 201: ok('Reported'), 400: R400 }
      })
    },
    '/api/incidents/{id}': {
      patch: op('Incidents', 'Edit an incident', STAFF, {
        parameters: [idParam('Incident id')],
        requestBody: body(ref('IncidentEdit')),
        responses: {
          200: ok('Updated; `changed` lists the fields that differed', { type: 'object', properties: { message: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } } } }),
          400: R400, 404: err('Incident not found'), 409: err('Incident is closed')
        }
      })
    },
    '/api/incidents/{id}/status': {
      patch: op('Incidents', 'Escalate, close or reopen an incident', STAFF, {
        parameters: [idParam('Incident id')],
        requestBody: body(ref('IncidentStatusChange')),
        responses: {
          200: ok('Status changed', { type: 'object', properties: { message: { type: 'string' }, status: { type: 'string' } } }),
          400: R400, 404: err('Incident not found'), 409: err('Already in that status')
        }
      })
    },
    '/api/incidents/{id}/audit': {
      get: op('Incidents', 'Incident audit trail', STAFF, {
        parameters: [idParam('Incident id')],
        responses: { 200: ok('Who changed what and when', list('audit')), 404: err('Incident not found') }
      })
    },

    '/api/inspections/list': {
      get: op('Inspections', 'List inspections', `${STAFF}, CLIENT`, {
        parameters: [query('siteId', 'Only this site')],
        responses: { 200: ok('Inspections', list('inspections')) }
      })
    },
    '/api/inspections/submit': {
      post: op('Inspections', 'Submit an inspection', 'VO, NVO, SM', {
        requestBody: body(ref('InspectionSubmit')),
        responses: { 201: ok('Recorded'), 400: R400 }
      })
    },

    '/api/visits/arrive': {
      post: op('Visits', 'Record arrival at a site', 'VO, NVO', {
        description: 'Starts a visit and checks the position against the site\'s geofence. An older visit left open for more than 16 hours is closed automatically first.',
        requestBody: body(ref('ArriveRequest')),
        responses: { 201: ok('Visit started'), 400: R400, 404: err('Site not found'), 409: err('A visit is already open') }
      })
    },
    '/api/visits/{id}/depart': {
      post: op('Visits', 'Record departure', 'VO, NVO (own visit only)', {
        parameters: [idParam('Visit id')],
        requestBody: body(ref('DepartRequest'), false),
        responses: {
          200: ok('Visit ended', { type: 'object', properties: { message: { type: 'string' }, durationMinutes: { type: 'integer' } } }),
          400: R400, 404: err('Visit not found'), 409: err('Visit already ended')
        }
      })
    },
    '/api/visits/ping': {
      post: op('Visits', 'Send a location update', 'VO, NVO', {
        requestBody: body(ref('PingRequest')),
        responses: { 201: ok('Recorded'), 400: R400 }
      })
    },
    '/api/visits/mine': {
      get: op('Visits', 'My open visit and today\'s visits', 'VO, NVO', { responses: { 200: ok('Open visit (or null) and today\'s list') } })
    },
    '/api/visits/list': {
      get: op('Visits', 'Visits for a day', STAFF, {
        parameters: [dateQuery('date', 'Defaults to today (Asia/Colombo)')],
        responses: { 200: ok('Visits', { type: 'object', properties: { date: { type: 'string', format: 'date' }, visits: { type: 'array', items: { type: 'object' } } } }), 400: R400 }
      })
    },
    '/api/visits/live': {
      get: op('Visits', 'Live officer positions', 'MD, GM, AGM, SM, CONTROL_ROOM', {
        description: 'Latest position per officer. NVO positions are visible to MD and GM only. Visit details for sites outside the caller\'s scope are blanked.',
        parameters: [query('minutes', 'How recent a position must be, 1 to the server maximum', { type: 'integer', minimum: 1 })],
        responses: { 200: ok('Officers with their last position'), 400: R400 }
      })
    },

    '/api/feedback/sites': {
      get: op('Feedback', 'Sites a client may rate', 'CLIENT', { responses: { 200: ok('Sites', list('sites')) } })
    },
    '/api/feedback/visits': {
      get: op('Feedback', 'Recent visits a client can give feedback on', 'CLIENT', { responses: { 200: ok('Visits', list('visits')) } })
    },
    '/api/feedback': {
      post: op('Feedback', 'Submit feedback', 'CLIENT', {
        requestBody: body(ref('FeedbackSubmit')),
        responses: {
          201: ok('Recorded', { type: 'object', properties: { message: { type: 'string' }, feedbackId: { type: 'string' }, isComplaint: { type: 'boolean' } } }),
          400: R400, 404: err('Site not found'), 409: err('Feedback already given for that visit')
        }
      })
    },
    '/api/feedback/list': {
      get: op('Feedback', 'List feedback', 'MD, GM, AGM, SM, CONTROL_ROOM, CLIENT', {
        description: 'Management sees feedback for their scope; a client sees only their own.',
        parameters: [query('status', 'New, Acknowledged or Resolved', { type: 'string', enum: ['New', 'Acknowledged', 'Resolved'] }), query('complaints', 'true to return only complaints')],
        responses: { 200: ok('Feedback', list('feedback')), 400: R400 }
      })
    },
    '/api/feedback/{id}/status': {
      patch: op('Feedback', 'Acknowledge or resolve feedback', 'MD, GM, AGM, SM, CONTROL_ROOM', {
        parameters: [idParam('Feedback id')],
        requestBody: body(ref('FeedbackStatusChange')),
        responses: {
          200: ok('Status changed', { type: 'object', properties: { message: { type: 'string' }, status: { type: 'string' } } }),
          400: R400, 404: err('Feedback not found'), 409: err('Already in that status')
        }
      })
    },

    '/api/reports/types': {
      get: op('Reports', 'Report types', STAFF, {
        responses: { 200: ok('Types', { type: 'object', properties: { types: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, title: { type: 'string' } } } } } }) }
      })
    },
    '/api/reports/daily': {
      get: op('Reports', 'Build a daily report', STAFF, {
        parameters: [
          { name: 'type', in: 'query', required: true, schema: { type: 'string', enum: ['incidents', 'attendance', 'visits', 'complaints', 'emergency', 'night-visits', 'kpi', 'operations'] } },
          dateQuery('date', 'Defaults to today (Asia/Colombo)')
        ],
        responses: { 200: ok('The report'), 400: R400 }
      })
    },
    '/api/reports/archive': {
      get: op('Reports', 'Archived nightly report', 'MD, GM', {
        description: 'The organisation-wide copy stored overnight for a past day.',
        parameters: [
          { name: 'type', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: { 200: ok('The stored report'), 400: R400, 404: err('No archived copy for that date yet') }
      })
    }
  }
};

export default spec;
