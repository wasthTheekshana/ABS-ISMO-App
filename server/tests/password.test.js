import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import pool from '../db/pool.js';
import { seedMasterData, closePool, USERS, PASSWORD, bearer } from './helpers/fixtures.js';
import { TEST_JWT_SECRET } from './testEnv.js';
import { validateNewPasscode } from '../routes/auth.routes.js';

// NOTE: the change-password limiter (10 / 15 min / IP) is per module instance, i.e. per test
// file. Keep the number of POST /change-password calls in this file below 10.

const USER = USERS.SM_1;
const NEW_PASSCODE = 'My-Own-Passcode-7';

const login = (epf, password) => request(app).post('/api/auth/login').send({ epf, password });
const changePassword = (token, body) =>
  request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  await seedMasterData();
  // This account is still on its initial passcode.
  await pool.query(`UPDATE users SET must_change_password = TRUE WHERE epf = $1`, [USER.epf]);
});
afterAll(closePool);

describe('validateNewPasscode', () => {
  it.each([
    ['too short', 'abc12', 'old-pass-1', /at least 8/],
    ['letters only', 'abcdefghij', 'old-pass-1', /letter and one number/],
    ['numbers only', '1234567890', 'old-pass-1', /letter and one number/],
    ['same as current', 'Same-Pass-1', 'Same-Pass-1', /different/],
    ['the shared initial passcode', 'PassCode123', 'old-pass-1', /not allowed/],
    ['longer than bcrypt can use', `a1${'x'.repeat(80)}`, 'old-pass-1', /at most 72/]
  ])('rejects %s', (_label, candidate, current, message) => {
    expect(validateNewPasscode(candidate, current)).toMatch(message);
  });

  it('accepts a reasonable passcode', () => {
    expect(validateNewPasscode(NEW_PASSCODE, PASSWORD)).toBeNull();
  });
});

describe('forced passcode change on first login', () => {
  let restrictedToken;

  it('login tells the client the passcode must be changed and issues a restricted token', async () => {
    const res = await login(USER.epf, PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(jwt.verify(res.body.token, TEST_JWT_SECRET).mcp).toBe(true);
    restrictedToken = res.body.token;
  });

  it('a restricted token cannot read any business data', async () => {
    for (const path of ['/api/sites', '/api/officers', '/api/kpis/executive', '/api/absence/logs', '/api/incidents/list']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${restrictedToken}`);
      expect(res.status, path).toBe(403);
      expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
  });

  it('a restricted token cannot submit reports either', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${restrictedToken}`)
      .send({ epf: USER.epf, siteId: 'T-SITE-A', shift: 'Day' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('a restricted token can still read the profile', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${restrictedToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('a normal token (no restriction) is unaffected', async () => {
    const res = await request(app).get('/api/sites').set(bearer(USERS.GM));
    expect(res.status).toBe(200);
  });

  it('refuses a wrong current passcode', async () => {
    const res = await changePassword(restrictedToken, { currentPassword: 'wrong-Pass-1', newPassword: NEW_PASSCODE });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/current passcode is incorrect/i);
  });

  it('refuses a weak, reused or initial new passcode', async () => {
    const short = await changePassword(restrictedToken, { currentPassword: PASSWORD, newPassword: 'a1' });
    const same = await changePassword(restrictedToken, { currentPassword: PASSWORD, newPassword: PASSWORD });
    const initial = await changePassword(restrictedToken, { currentPassword: PASSWORD, newPassword: 'passcode123' });

    expect([short.status, same.status, initial.status]).toEqual([400, 400, 400]);
  });

  it('requires both fields', async () => {
    const res = await changePassword(restrictedToken, { newPassword: NEW_PASSCODE });
    expect(res.status).toBe(400);
  });

  it('rejects an unauthenticated change attempt', async () => {
    const res = await request(app).post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSCODE });
    expect(res.status).toBe(401);
  });

  it('changing the passcode lifts the restriction and stores only a hash of the new one', async () => {
    const res = await changePassword(restrictedToken, { currentPassword: PASSWORD, newPassword: NEW_PASSCODE });

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
    expect(jwt.verify(res.body.token, TEST_JWT_SECRET).mcp).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(NEW_PASSCODE);

    const stored = (await pool.query(`SELECT password_hash, must_change_password FROM users WHERE epf = $1`, [USER.epf])).rows[0];
    expect(stored.must_change_password).toBe(false);
    expect(stored.password_hash).not.toBe(NEW_PASSCODE);
    expect(await bcrypt.compare(NEW_PASSCODE, stored.password_hash)).toBe(true);

    const sites = await request(app).get('/api/sites').set('Authorization', `Bearer ${res.body.token}`);
    expect(sites.status).toBe(200);
  });

  it('the old passcode stops working and the new one logs in without a restriction', async () => {
    const oldLogin = await login(USER.epf, PASSWORD);
    const newLogin = await login(USER.epf, NEW_PASSCODE);

    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(false);
    expect(jwt.verify(newLogin.body.token, TEST_JWT_SECRET).mcp).toBeUndefined();
  });
});
