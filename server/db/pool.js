import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Never fall back to a well-known default password on a production server.
if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD must be set when NODE_ENV=production');
}

// Connection Pool Configuration reading from Environment Variables
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'isoms_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20, // Maximum pool connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Parameterized Query Execution Helper
 * Strictly enforces parameterized query security ($1, $2, etc.) to prevent SQL Injection attacks.
 * @param {string} text - SQL Query String containing placeholders ($1, $2)
 * @param {Array} params - Query parameters array
 */
export const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DB Query Executed] duration: ${duration}ms | rows: ${res.rowCount}`);
    }
    return res;
  } catch (error) {
    console.error('[DB Query Error]:', error.message);
    throw error;
  }
};

export default pool;
