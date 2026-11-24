-- AB Securitas ISOMS - Phase 2 DDL Schema Extension
-- Multi-Category Incidents (Security, Safety, Medical, Operational) & Digital Site Visit Inspections

-- 1. Multi-Category Incidents Table (SRS FR-9 to FR-13)
CREATE TABLE IF NOT EXISTS incidents (
    incident_id VARCHAR(50) PRIMARY KEY,
    category VARCHAR(50) NOT NULL, -- Operational, Security, Safety, Medical
    sub_type VARCHAR(100) NOT NULL, -- Theft, Fire, Injury, Equipment Failure, etc.
    severity VARCHAR(20) NOT NULL DEFAULT 'Medium', -- Critical, High, Medium, Low
    site_id VARCHAR(50) REFERENCES sites(site_id) ON DELETE CASCADE,
    site_name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    gps_lat DECIMAL(10, 8),
    gps_lng DECIMAL(11, 8),
    photo_urls TEXT[],
    witness_details TEXT,
    action_taken TEXT,
    police_notified BOOLEAN DEFAULT FALSE,
    hospital_notified BOOLEAN DEFAULT FALSE,
    fire_notified BOOLEAN DEFAULT FALSE,
    estimated_loss DECIMAL(12, 2) DEFAULT 0,
    reported_by VARCHAR(150) NOT NULL,
    status VARCHAR(50) DEFAULT 'Open & Investigating',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes for Incident Queries & Alert Dashboards
CREATE INDEX IF NOT EXISTS idx_incidents_cat_site ON incidents(category, site_id);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);

-- 2. Digital Site Visit Inspection Checklist Table (SRS FR-15)
CREATE TABLE IF NOT EXISTS site_inspections (
    inspection_id VARCHAR(50) PRIMARY KEY,
    site_id VARCHAR(50) REFERENCES sites(site_id) ON DELETE CASCADE,
    site_name VARCHAR(150) NOT NULL,
    inspector_epf VARCHAR(30) NOT NULL,
    inspector_name VARCHAR(100) NOT NULL,
    uniform_check BOOLEAN NOT NULL DEFAULT TRUE,
    id_check BOOLEAN NOT NULL DEFAULT TRUE,
    register_check BOOLEAN NOT NULL DEFAULT TRUE,
    cctv_check BOOLEAN NOT NULL DEFAULT TRUE,
    fire_eq_check BOOLEAN NOT NULL DEFAULT TRUE,
    site_rating VARCHAR(20) NOT NULL DEFAULT 'Good', -- Excellent, Good, Average, Poor
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance Index for Site Inspection History
CREATE INDEX IF NOT EXISTS idx_inspections_site_date ON site_inspections(site_id, created_at DESC);

-- ============================================================================
-- 3. Incident closure workflow, client representative and edit audit trail
--    (SRS FR-9..13, NFR-5). Idempotent: safe to re-run.
-- ============================================================================
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS client_rep_details TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_by VARCHAR(150);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closure_notes TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- One row per changed field, never updated or deleted by the application (chain of custody).
CREATE TABLE IF NOT EXISTS incident_audit (
    id SERIAL PRIMARY KEY,
    incident_id VARCHAR(50) NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
    changed_by VARCHAR(150) NOT NULL,
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    field VARCHAR(50) NOT NULL,
    old_value TEXT,
    new_value TEXT
);
CREATE INDEX IF NOT EXISTS idx_incident_audit_incident ON incident_audit(incident_id, changed_at);

-- ============================================================================
-- 4. Full SRS FR-15 inspection checklist. New items are nullable:
--    NULL = not recorded / not applicable (e.g. weapons at an unarmed site).
-- ============================================================================
ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS presence_check BOOLEAN;
ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS grooming_check BOOLEAN;
ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS alarm_check BOOLEAN;
ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS client_satisfaction_check BOOLEAN;
ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS cleanliness_check BOOLEAN;
ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS equipment_check BOOLEAN;
ALTER TABLE site_inspections ADD COLUMN IF NOT EXISTS weapons_check BOOLEAN;

-- ============================================================================
-- 5. Client role (SRS FR-20): which sites a CLIENT user may see.
-- ============================================================================
CREATE TABLE IF NOT EXISTS client_sites (
    client_epf VARCHAR(30) NOT NULL REFERENCES users(epf) ON DELETE CASCADE,
    site_id VARCHAR(50) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    PRIMARY KEY (client_epf, site_id)
);

-- ============================================================================
-- 6. GPS site visits and live location (SRS FR-8, FR-14). Idempotent.
-- ============================================================================
-- Site coordinates: used for the arrival geofence and the map markers.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 8);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lng DECIMAL(11, 8);

CREATE TABLE IF NOT EXISTS site_visits (
    visit_id VARCHAR(50) PRIMARY KEY,
    officer_epf VARCHAR(30) NOT NULL REFERENCES users(epf) ON DELETE CASCADE,
    officer_name VARCHAR(100) NOT NULL,
    officer_role VARCHAR(30) NOT NULL,
    site_id VARCHAR(50) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    site_name VARCHAR(150) NOT NULL,
    arrived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    departed_at TIMESTAMP WITH TIME ZONE,
    arrival_lat DECIMAL(10, 8),
    arrival_lng DECIMAL(11, 8),
    departure_lat DECIMAL(10, 8),
    departure_lng DECIMAL(11, 8),
    distance_from_site_m INT,            -- arrival fix to the site's coordinates; NULL when unknown
    on_site BOOLEAN,                     -- inside the geofence; NULL when unknown
    travel_km DECIMAL(8, 2) NOT NULL DEFAULT 0, -- travelled since the previous departure today
    duration_minutes INT,
    notes TEXT
);
-- An officer can be at only one site at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_one_open_per_officer ON site_visits(officer_epf) WHERE departed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_visits_site_arrived ON site_visits(site_id, arrived_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_officer_arrived ON site_visits(officer_epf, arrived_at DESC);

-- Breadcrumb trail: one row per location fix (arrival, departure and the periodic pings).
CREATE TABLE IF NOT EXISTS location_pings (
    id BIGSERIAL PRIMARY KEY,
    officer_epf VARCHAR(30) NOT NULL REFERENCES users(epf) ON DELETE CASCADE,
    visit_id VARCHAR(50) REFERENCES site_visits(visit_id) ON DELETE SET NULL,
    lat DECIMAL(10, 8) NOT NULL,
    lng DECIMAL(11, 8) NOT NULL,
    accuracy_m INT,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pings_officer_time ON location_pings(officer_epf, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pings_time ON location_pings(recorded_at DESC);

-- ============================================================================
-- 7. Client feedback after a site visit (SRS FR-16). Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS client_feedback (
    feedback_id VARCHAR(50) PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    site_name VARCHAR(150) NOT NULL,
    client_epf VARCHAR(30) NOT NULL REFERENCES users(epf) ON DELETE CASCADE,
    client_name VARCHAR(100) NOT NULL,
    visit_id VARCHAR(50) REFERENCES site_visits(visit_id) ON DELETE SET NULL,
    punctuality SMALLINT NOT NULL CHECK (punctuality BETWEEN 1 AND 5),
    discipline SMALLINT NOT NULL CHECK (discipline BETWEEN 1 AND 5),
    grooming SMALLINT NOT NULL CHECK (grooming BETWEEN 1 AND 5),
    communication SMALLINT NOT NULL CHECK (communication BETWEEN 1 AND 5),
    overall_rating SMALLINT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
    complaints TEXT NOT NULL DEFAULT '',
    suggestions TEXT NOT NULL DEFAULT '',
    is_complaint BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'New',   -- New, Acknowledged, Resolved
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(150),
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- One piece of feedback per client per visit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_client_visit ON client_feedback(client_epf, visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_site_created ON client_feedback(site_id, created_at DESC);

-- ============================================================================
-- 8. Archive of the automatically generated daily reports (SRS FR-18). Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_reports (
    report_date DATE NOT NULL,
    report_type VARCHAR(30) NOT NULL,
    payload JSONB NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (report_date, report_type)
);
