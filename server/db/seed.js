import pool, { query } from './pool.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seedDatabase() {
  console.log('--- Starting AB Securitas ISOMS Database Migration & Seed ---');
  try {
    // 1. Run DDL Schema SQL
    // schema_phase2.sql holds incidents, inspections, the audit trail and client sites;
    // without it a fresh server has no tables for those routes.
    for (const file of ['schema.sql', 'schema_phase2.sql']) {
      await pool.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    }
    console.log('✔ DDL Schema & Indexes initialized successfully.');

    // 2. Seed User Accounts (with hashed passcodes)
    const salt = await bcrypt.genSalt(10);
    const defaultPasswordHash = await bcrypt.hash('passcode123', salt);

    const usersData = [
      // Placeholder Managing Director account — replace the name/EPF with the real MD before go-live.
      ['EPF-000', 'Managing Director', 'MD', 'Managing Director', 'All Sri Lanka', 'All Sectors', defaultPasswordHash],
      ['EPF-001', 'Chamara Waduge', 'GM', 'GM - Static SBU', 'All Sri Lanka', 'All Sectors', defaultPasswordHash],
      ['EPF-012', 'K. Bandara', 'AGM', 'AGM - Western Region', 'Western Province', 'All Western Sectors', defaultPasswordHash],
      ['EPF-045', 'Sunil Jayasinghe', 'SM', 'Sector Manager - Colombo Central', 'Western Province', 'Sector 01 - Colombo Metro', defaultPasswordHash],
      ['EPF-1042', 'Chaminda Perera', 'VO', 'Visiting Officer - Day Shift', 'Western Province', 'Sector 01 - Colombo Metro', defaultPasswordHash],
      ['EPF-1088', 'Nuwan Pradeep', 'NVO', 'Night Visiting Officer', 'Western Province', 'Sector 01 - Colombo Metro', defaultPasswordHash],
      ['EPF-0999', 'Sujith Fernando', 'CONTROL_ROOM', '24/7 Operations Control Room', 'All Sri Lanka', 'All Sectors', defaultPasswordHash],
      // Demo Security Guard (same EPF as the guard roster entry below) and demo Client — replace before go-live.
      ['ABS-7041', 'R.M. Gamini', 'SECURITY_GUARD', 'Senior Security Officer', 'Western Province', 'Sector 01 - Colombo Metro', defaultPasswordHash],
      ['CLIENT-001', 'Abans Facilities Manager', 'CLIENT', 'Client - Abans Head Office', 'Western Province', 'Sector 01 - Colombo Metro', defaultPasswordHash]
    ];

    // New accounts start with the shared initial passcode and MUST change it at first login.
    // Re-running the seed refreshes profile data but never touches an existing account's
    // password, so a passcode someone has already chosen is not reset back to the default.
    for (const u of usersData) {
      await query(
        `INSERT INTO users (epf, name, role, title, region, sector, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         ON CONFLICT (epf) DO UPDATE SET
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           title = EXCLUDED.title,
           region = EXCLUDED.region,
           sector = EXCLUDED.sector;`,
        u
      );
    }
    console.log('✔ User accounts seeded.');

    // 3. Seed Sites Master Data
    const sitesData = [
      ['SITE-COL-01', 'Abans Head Office - Kollupitiya', 'Sector 01 - Colombo Metro', 'Western Province', 12, 10, 'EPF-1042', 'EPF-1088', 'Alert', 'Kollupitiya, Colombo 03'],
      ['SITE-COL-02', 'Cargills Bank Main Branch', 'Sector 01 - Colombo Metro', 'Western Province', 8, 8, 'EPF-1042', 'EPF-1088', 'Optimal', 'Fort, Colombo 01'],
      ['SITE-GAM-05', 'Biyagama EPZ Industrial Complex', 'Sector 02 - Gampaha Zone', 'Western Province', 25, 22, 'EPF-1042', 'EPF-1088', 'Alert', 'Biyagama Free Trade Zone'],
      ['SITE-COL-09', 'Colombo Port Maritime Gate 3', 'Sector 01 - Colombo Metro', 'Western Province', 15, 14, 'EPF-1042', 'EPF-1088', 'Optimal', 'Port Access Rd, Colombo'],
      ['SITE-KND-03', 'Kandy City Centre Retail Mall', 'Sector 04 - Central Region', 'Central Province', 18, 18, 'EPF-1042', 'EPF-1088', 'Optimal', 'Dalada Veediya, Kandy']
    ];

    for (const s of sitesData) {
      await query(
        `INSERT INTO sites (site_id, name, sector, region, required_officers, current_on_duty, assigned_vo, assigned_nvo, status, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (site_id) DO UPDATE SET
           name = EXCLUDED.name,
           sector = EXCLUDED.sector,
           region = EXCLUDED.region,
           required_officers = EXCLUDED.required_officers,
           current_on_duty = EXCLUDED.current_on_duty,
           assigned_vo = EXCLUDED.assigned_vo,
           assigned_nvo = EXCLUDED.assigned_nvo,
           status = EXCLUDED.status,
           location = EXCLUDED.location;`,
        s
      );
    }
    console.log('✔ Security Sites seeded.');

    // Site coordinates drive the arrival geofence and the live-map markers (SRS FR-8, FR-14).
    // Demo values, approximate: replace with surveyed coordinates for the real sites.
    const siteCoordinates = [
      ['SITE-COL-01', 6.9120, 79.8510],
      ['SITE-COL-02', 6.9335, 79.8428],
      ['SITE-GAM-05', 6.9520, 79.9930],
      ['SITE-COL-09', 6.9440, 79.8480],
      ['SITE-KND-03', 7.2937, 80.6411]
    ];
    for (const [siteId, lat, lng] of siteCoordinates) {
      await query('UPDATE sites SET lat = $2, lng = $3 WHERE site_id = $1', [siteId, lat, lng]);
    }
    console.log('✔ Site coordinates seeded.');

    // 4. Seed Security Guards
    const guardsData = [
      ['ABS-7041', 'R.M. Gamini', 'Senior Security Officer', 'SITE-COL-01'],
      ['ABS-7088', 'W.A. Karunaratne', 'Security Guard', 'SITE-COL-01'],
      ['ABS-7102', 'T.H. Danushka', 'Security Guard', 'SITE-COL-01'],
      ['ABS-6945', 'M.S. Cooray', 'Junior Officer', 'SITE-COL-02'],
      ['ABS-8110', 'P.K. Sampath', 'Armed Guard', 'SITE-GAM-05'],
      ['ABS-8115', 'D.M. Ranasinghe', 'Security Guard', 'SITE-GAM-05']
    ];

    for (const g of guardsData) {
      await query(
        `INSERT INTO security_guards (epf, name, rank, site_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (epf) DO UPDATE SET
           name = EXCLUDED.name,
           rank = EXCLUDED.rank,
           site_id = EXCLUDED.site_id;`,
        g
      );
    }
    console.log('✔ Security Guards seeded.');

    // 5. Link the demo client to the one site they may see (SRS FR-20).
    await query(
      `INSERT INTO client_sites (client_epf, site_id) VALUES ('CLIENT-001', 'SITE-COL-01') ON CONFLICT DO NOTHING`
    );
    console.log('✔ Client site access seeded.');

    console.log('--- DB Migration & Seed Completed Successfully ---');
  } catch (err) {
    console.error('Database Seeding Failed:', err);
  } finally {
    await pool.end();
  }
}

seedDatabase();
