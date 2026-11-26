import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

/**
 * Applies the database schema and nothing else: no demo accounts, no sample sites.
 * This is what a real server runs (`npm run db:migrate`). `db:seed` also loads demo data with a
 * shared passcode and must never be run against production.
 *
 * Both schema files are idempotent (CREATE ... IF NOT EXISTS), so running this again after an
 * update is safe and only adds what is missing.
 */
const dir = path.dirname(fileURLToPath(import.meta.url));

try {
  for (const file of ['schema.sql', 'schema_phase2.sql']) {
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`applied ${file}`);
  }
  console.log('Database schema is up to date.');
} catch (error) {
  console.error('Schema migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
