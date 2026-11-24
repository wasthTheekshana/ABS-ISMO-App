/**
 * AB Securitas ISOMS - Dynamic API Service Layer
 * Reads API Base URL dynamically from Vite environment variables (VITE_API_BASE_URL).
 * NO hardcoded API endpoints.
 */

// Default to the API on the same host the page was loaded from, so the dashboard keeps
// working when the PC's LAN IP changes. VITE_API_BASE_URL overrides it for deployments.
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:5010/api`;

const TOKEN_STORAGE_KEY = 'isoms_session_token';

export const getStoredToken = () => {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const setStoredToken = (token) => {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private browsing, etc) — session just won't persist across reloads.
  }
};

async function fetchJson(endpoint, options = {}) {
  try {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      },
      ...options
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      const err = new Error(errData.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.details = errData; // e.g. { existingRecord } on a 409 duplicate-entry conflict
      throw err;
    }

    return await res.json();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[ISOMS API Call Info] ${endpoint}:`, error.message);
    }
    throw error;
  }
}

export const apiService = {
  // Auth API
  login: (epf, password) =>
    fetchJson('/auth/login', { method: 'POST', body: JSON.stringify({ epf, password }) }),

  getCurrentUser: () =>
    fetchJson('/auth/me'),

  changePassword: (currentPassword, newPassword) =>
    fetchJson('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Sites API — role/region/sector/epf scoping is derived server-side from the caller's token
  getSites: () =>
    fetchJson('/sites'),

  // Executive KPIs API — same server-side scoping as above
  getExecutiveKPIs: (range) =>
    fetchJson(range ? `/kpis/executive?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : '/kpis/executive'),

  // Officers API — real security_guards roster, scoped server-side like /sites
  getOfficers: () =>
    fetchJson('/officers'),

  // Read-only audit feeds. Field staff submit records from the ISOMS mobile app.
  getAbsenceLogs: () =>
    fetchJson('/absence/logs'),

  getLateLogs: () =>
    fetchJson('/late/logs'),

  getIncidents: (category, siteId) => {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (siteId) params.append('siteId', siteId);
    return fetchJson(`/incidents/list?${params.toString()}`);
  },

  getInspections: (siteId) => {
    const params = new URLSearchParams();
    if (siteId) params.append('siteId', siteId);
    return fetchJson(`/inspections/list?${params.toString()}`);
  },

  // Incident workflow (SRS FR-13, NFR-5): escalate / close (notes required) / reopen, and the edit trail.
  updateIncidentStatus: (incidentId, status, closureNotes) =>
    fetchJson(`/incidents/${encodeURIComponent(incidentId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, closureNotes })
    }),

  // Control Room operations board: open incidents, short-staffed sites, today's absences/lates.
  getControlRoomBoard: () =>
    fetchJson('/control-room/board'),

  // GPS site visits and the live officer map (SRS FR-8, FR-14)
  getLiveMap: (minutes) =>
    fetchJson(`/visits/live${minutes ? `?minutes=${encodeURIComponent(minutes)}` : ''}`),

  getVisits: (date) =>
    fetchJson(`/visits/list${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  // Daily reports (SRS FR-18). `archived` reads the stored organisation-wide copy (MD, GM only).
  getReportTypes: () =>
    fetchJson('/reports/types'),

  getDailyReport: (type, date, archived = false) =>
    fetchJson(`/reports/${archived ? 'archive' : 'daily'}?type=${encodeURIComponent(type)}&date=${encodeURIComponent(date)}`),

  // Client feedback (SRS FR-16)
  getFeedback: ({ status, complaints } = {}) => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (complaints) params.append('complaints', '1');
    return fetchJson(`/feedback/list?${params.toString()}`);
  },

  updateFeedbackStatus: (feedbackId, status, resolutionNotes) =>
    fetchJson(`/feedback/${encodeURIComponent(feedbackId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolutionNotes })
    }),

  getFeedbackSites: () =>
    fetchJson('/feedback/sites'),

  getFeedbackVisits: () =>
    fetchJson('/feedback/visits'),

  submitFeedback: (payload) =>
    fetchJson('/feedback', { method: 'POST', body: JSON.stringify(payload) }),

  getIncidentAudit: (incidentId) =>
    fetchJson(`/incidents/${encodeURIComponent(incidentId)}/audit`)
};
