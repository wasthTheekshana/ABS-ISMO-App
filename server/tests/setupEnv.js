// Runs in every test worker BEFORE the test file imports the app, so server/db/pool.js
// and the auth middleware pick up the test database and secret.
import { TEST_DB_NAME, TEST_JWT_SECRET } from './testEnv.js';

process.env.DB_NAME = TEST_DB_NAME;
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.NODE_ENV = 'test';
