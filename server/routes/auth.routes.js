import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';
import {
  validatePayload,
  authenticate,
  loginRateLimiter,
  passwordChangeRateLimiter
} from '../middleware/security.js';

const router = express.Router();

const TOKEN_TTL = '12h';

// The initial passcode every seeded account starts with. It can never be chosen as a new one.
const INITIAL_PASSCODES = ['passcode123'];

/**
 * `mcp` ("must change password") marks a token issued while the account still has its
 * initial passcode; `authenticate` then restricts it to /auth/me and /auth/change-password.
 */
const signToken = (user, { mustChangePassword = false } = {}) =>
  jwt.sign(
    {
      epf: user.epf,
      name: user.name,
      role: user.role,
      title: user.title,
      region: user.region,
      sector: user.sector,
      ...(mustChangePassword ? { mcp: true } : {})
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: TOKEN_TTL }
  );

const toProfile = (row) => ({
  epf: row.epf,
  name: row.name,
  role: row.role,
  title: row.title,
  region: row.region,
  sector: row.sector,
  mustChangePassword: row.must_change_password === true
});

/** Returns an error message if the new passcode is unacceptable, otherwise null. */
export const validateNewPasscode = (newPassword, currentPassword) => {
  if (typeof newPassword !== 'string') return 'New passcode must be text';
  if (newPassword.length < 8) return 'New passcode must be at least 8 characters';
  if (Buffer.byteLength(newPassword, 'utf8') > 72) return 'New passcode must be at most 72 bytes';
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return 'New passcode must contain at least one letter and one number';
  }
  if (newPassword === currentPassword) return 'New passcode must be different from the current one';
  if (INITIAL_PASSCODES.includes(newPassword.toLowerCase())) return 'That passcode is not allowed — choose your own';
  return null;
};

// POST /api/auth/login
router.post('/login', loginRateLimiter, validatePayload(['epf', 'password']), async (req, res) => {
  try {
    const { epf, password } = req.body;

    // Parameterized Query preventing SQL Injection ($1)
    const result = await query(
      `SELECT epf, name, role, title, region, sector, password_hash, must_change_password
       FROM users
       WHERE epf = $1`,
      [epf]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid EPF Staff ID or credentials' });
    }

    const row = result.rows[0];
    const isMatch = await bcrypt.compare(password, row.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid EPF Staff ID or credentials' });
    }

    const user = toProfile(row);
    return res.json({
      message: 'Authentication successful',
      token: signToken(user, { mustChangePassword: user.mustChangePassword }),
      user
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server authentication failure' });
  }
});

// GET /api/auth/me (Restore session from a stored token)
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT epf, name, role, title, region, sector, must_change_password FROM users WHERE epf = $1`,
      [req.user.epf]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }

    return res.json({ user: toProfile(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to restore session' });
  }
});

// POST /api/auth/change-password — also the only way out of a "must change" session.
router.post(
  '/change-password',
  authenticate,
  passwordChangeRateLimiter,
  validatePayload(['currentPassword', 'newPassword']),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      const problem = validateNewPasscode(newPassword, currentPassword);
      if (problem) return res.status(400).json({ error: problem });

      const result = await query(
        `SELECT epf, name, role, title, region, sector, password_hash FROM users WHERE epf = $1`,
        [req.user.epf]
      );
      if (result.rows.length === 0) return res.status(401).json({ error: 'Account no longer exists' });

      const row = result.rows[0];
      if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, row.password_hash))) {
        return res.status(401).json({ error: 'Current passcode is incorrect' });
      }

      const hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
      await query(`UPDATE users SET password_hash = $2, must_change_password = FALSE WHERE epf = $1`, [row.epf, hash]);

      // Fresh token without the restriction; any older token keeps working until it expires,
      // which is the same lifetime as an ordinary session.
      const user = toProfile({ ...row, must_change_password: false });
      return res.json({ message: 'Passcode changed', token: signToken(user), user });
    } catch (error) {
      console.error('Change password error:', error);
      return res.status(500).json({ error: 'Failed to change passcode' });
    }
  }
);

export default router;
