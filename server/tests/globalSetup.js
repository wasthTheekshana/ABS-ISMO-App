import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import { TEST_DB_NAME } from './testEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Recreates the isolated test database, then applies the real schema files.
 * Connection host/port/credentials come from .env; the database NAME is forced to
 * isoms_test so the development database (isoms_db) can never be touched by a test run.
 */
export default async function setup() {
  if (!TEST_DB_NAME.endsWith('_test')) {
    throw new Error(`Refusing to run: test DB name "${TEST_DB_NAME}" must end in _test`);
  }

  const conn = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  };

  const admin = new pg.Client({ ...conn, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const db = new pg.Client({ ...conn, database: TEST_DB_NAME });
  await db.connect();
  try {
    for (const file of ['schema.sql', 'schema_phase2.sql']) {
      await db.query(fs.readFileSync(path.resolve(__dirname, '../db', file), 'utf8'));
    }
  } finally {
    await db.end();
  }
}
