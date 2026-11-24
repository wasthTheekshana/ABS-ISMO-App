import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { seedMasterData, closePool, USERS, PASSWORD, tokenFor } from './helpers/fixtures.js';
import { TEST_JWT_SECRET } from './testEnv.js';

// NOTE: the login rate limiter (10 / 15 min / IP) is in-memory and per module instance.
// Vitest isolates modules per test FILE, so this file has its own budget. Keep the number
// of POST /login calls in the non-rate-limit tests below 10; the rate-limit test is last.

beforeAll(seedMasterData);
afterAll(closePool);

describe('POST /api/auth/login', () => {
  it('returns a token and the profile (without the password hash) for valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ epf: USERS.SM_1.epf, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ epf: USERS.SM_1.epf, role: 'SM', sector: 'Sector 01' });
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2[aby]\$/);
  });

  it('issues a JWT that carries the role/region/sector used for scoping', async () => {
    const res = await request(app).post('/api/auth/login').send({ epf: USERS.AGM_W.epf, password: PASSWORD });
    const payload = jwt.verify(res.body.token, TEST_JWT_SECRET);

    expect(payload).toMatchObject({ epf: USERS.AGM_W.epf, role: 'AGM', region: 'Western' });
    expect(payload.exp - payload.iat).toBe(12 * 60 * 60);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ epf: USERS.MD.epf, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('does not accept the old shared "passcode123" for any account (backdoor removed)', async () => {
    const res = await request(app).post('/api/auth/login').send({ epf: USERS.MD.epf, password: 'passcode123' });
    expect(res.status).toBe(401);
  });

  it('gives the same response for an unknown EPF as for a wrong password (no user enumeration)', async () => {
    const unknown = await request(app).post('/api/auth/login').send({ epf: 'NOPE-999', password: PASSWORD });
    const wrongPw = await request(app).post('/api/auth/login').send({ epf: USERS.MD.epf, password: 'wrong' });

    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrongPw.body);
  });

  it('returns 400 when epf or password is missing', async () => {
    const noPw = await request(app).post('/api/auth/login').send({ epf: USERS.MD.epf });
    const noEpf = await request(app).post('/api/auth/login').send({ password: PASSWORD });

    expect(noPw.status).toBe(400);
    expect(noEpf.status).toBe(400);
  });

  it('treats SQL metacharacters in the EPF as plain data', async () => {
    const res = await request(app).post('/api/auth/login').send({ epf: "' OR '1'='1' --", password: PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('Bearer token verification (GET /api/auth/me)', () => {
  it('restores the session from a valid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(USERS.VO)}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ epf: USERS.VO.epf, role: 'VO' });
  });

  it('rejects a request with no Authorization header', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a non-Bearer scheme', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Basic ${tokenFor(USERS.VO)}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = jwt.sign({ ...USERS.MD }, 'attacker-secret', { expiresIn: '1h' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = tokenFor(USERS.MD, { expiresIn: '-10s' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('rejects an unsigned (alg=none) token', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...USERS.MD })}.`;
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${unsigned}`);
    expect(res.status).toBe(401);
  });

  it('rejects a payload that was tampered with after signing (role escalation)', async () => {
    const [h, , s] = tokenFor(USERS.SM_1).split('.');
    const escalated = Buffer.from(JSON.stringify({ ...USERS.SM_1, role: 'MD' })).toString('base64url');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${h}.${escalated}.${s}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when the token is valid but the account no longer exists', async () => {
    const ghost = tokenFor({ ...USERS.VO, epf: 'T-DELETED' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ghost}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/health', () => {
  it('is public', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HEALTHY');
  });
});

describe('login rate limiting', () => {
  it('returns 429 once the per-IP login budget is exhausted', async () => {
    // Earlier tests in this file already used part of the budget; keep going until blocked.
    let blocked = null;
    for (let i = 0; i < 15 && !blocked; i++) {
      const res = await request(app).post('/api/auth/login').send({ epf: USERS.MD.epf, password: 'wrong' });
      if (res.status === 429) blocked = res;
    }

    expect(blocked).not.toBeNull();
    expect(blocked.body.error).toMatch(/too many login attempts/i);
  });
});
