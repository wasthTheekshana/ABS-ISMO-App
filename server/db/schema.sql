-- AB Securitas ISOMS - Production PostgreSQL Database DDL Schema
-- Enforces data integrity, foreign keys, and performance indexing for query latency under 50ms

-- Extension for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users & Staff Organizational Master Table
CREATE TABLE IF NOT EXISTS users (
    epf VARCHAR(30) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(30) NOT NULL, -- MD, GM, AGM, SM, VO, NVO, CONTROL_ROOM
    title VARCHAR(150),
    region VARCHAR(100) NOT NULL,
    sector VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Accounts created from the seed start with a shared initial passcode; this flag forces the
-- user to choose their own before they can use any other endpoint.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Performance Index for Role-Based Access Control Scoping (SRS FR-6)
CREATE INDEX IF NOT EXISTS idx_users_role_region_sector ON users(role, region, sector);

-- 2. Security Sites Master Table
CREATE TABLE IF NOT EXISTS sites (
    site_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    sector VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    required_officers INT NOT NULL CHECK (required_officers >= 0),
    current_on_duty INT NOT NULL CHECK (current_on_duty >= 0),
    shortfall INT NOT NULL GENERATED ALWAYS AS (GREATEST(0, required_officers - current_on_duty)) STORED,
    assigned_vo VARCHAR(30) REFERENCES users(epf) ON DELETE SET NULL,
    assigned_nvo VARCHAR(30) REFERENCES users(epf) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'Optimal',
    location VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes for Site Queries & Scoping
CREATE INDEX IF NOT EXISTS idx_sites_region_sector ON sites(region, sector);
CREATE INDEX IF NOT EXISTS idx_sites_assigned_vo_nvo ON sites(assigned_vo, assigned_nvo);

-- 3. Security Guard Personnel Master Table
CREATE TABLE IF NOT EXISTS security_guards (
    epf VARCHAR(30) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    rank VARCHAR(50) NOT NULL,
    site_id VARCHAR(50) REFERENCES sites(site_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guards_site ON security_guards(site_id);

-- 4. Shift Duty Attendance Log Table
CREATE TABLE IF NOT EXISTS duty_attendance (
    id SERIAL PRIMARY KEY,
    epf VARCHAR(30) REFERENCES users(epf) ON DELETE CASCADE,
    site_id VARCHAR(50) REFERENCES sites(site_id) ON DELETE CASCADE,
    shift VARCHAR(100) NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE,
    check_out_time TIMESTAMP WITH TIME ZONE,
    gps_lat DECIMAL(10, 8),
    gps_lng DECIMAL(11, 8),
    status VARCHAR(50) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_attendance_epf_date ON duty_attendance(epf, date);
CREATE INDEX IF NOT EXISTS idx_attendance_site_date ON duty_attendance(site_id, date);

-- An officer can have at most ONE open shift. Enforced in the database so two simultaneous
-- check-ins cannot both succeed (the route's SELECT-then-INSERT alone is racy).
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_one_open_shift
    ON duty_attendance(epf) WHERE check_out_time IS NULL;

-- 5. Guard Absence Logs Audit Table (SRS FR-4, NFR-5)
CREATE TABLE IF NOT EXISTS absence_logs (
    log_id VARCHAR(50) PRIMARY KEY,
    epf VARCHAR(30) NOT NULL,
    officer_name VARCHAR(100) NOT NULL,
    site_id VARCHAR(50) REFERENCES sites(site_id) ON DELETE CASCADE,
    site_name VARCHAR(150) NOT NULL,
    date DATE NOT NULL,
    shift VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    replacement_deployed BOOLEAN NOT NULL DEFAULT FALSE,
    replacement_epf VARCHAR(100),
    notes TEXT,
    submitted_by VARCHAR(150) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'Logged & Verified'
);

CREATE INDEX IF NOT EXISTS idx_absence_site_date ON absence_logs(site_id, date);
CREATE INDEX IF NOT EXISTS idx_absence_timestamp ON absence_logs(timestamp DESC);

-- Prevents the same officer being logged absent twice for the same shift (SRS S3-03)
DO $$ BEGIN
    ALTER TABLE absence_logs ADD CONSTRAINT uq_absence_officer_date_shift UNIQUE (epf, date, shift);
EXCEPTION
    WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- 6. Late Reporting Logs Audit Table (SRS FR-5, NFR-5)
CREATE TABLE IF NOT EXISTS late_logs (
    log_id VARCHAR(50) PRIMARY KEY,
    epf VARCHAR(30) NOT NULL,
    officer_name VARCHAR(100) NOT NULL,
    site_id VARCHAR(50) REFERENCES sites(site_id) ON DELETE CASCADE,
    site_name VARCHAR(150) NOT NULL,
    date DATE NOT NULL,
    shift VARCHAR(100) NOT NULL,
    scheduled_time TIME NOT NULL,
    actual_time TIME NOT NULL,
    delay_minutes INT NOT NULL CHECK (delay_minutes >= 0),
    reason TEXT NOT NULL,
    remarks TEXT,
    submitted_by VARCHAR(150) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'Logged & Actioned'
);

CREATE INDEX IF NOT EXISTS idx_late_site_date ON late_logs(site_id, date);
CREATE INDEX IF NOT EXISTS idx_late_timestamp ON late_logs(timestamp DESC);

-- Prevents the same officer being logged late twice for the same shift (SRS S3-03)
DO $$ BEGIN
    ALTER TABLE late_logs ADD CONSTRAINT uq_late_officer_date_shift UNIQUE (epf, date, shift);
EXCEPTION
    WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
