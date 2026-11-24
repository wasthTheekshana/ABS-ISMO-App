/**
 * Security Middleware for AB Securitas ISOMS Express Server
 * Enforces security headers, CORS policies, and request sanitization.
 */

import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Standard security headers (CSP, HSTS, nosniff, frame-deny, etc) via helmet instead
// of hand-rolled ones — covers more cases and stays current with browser guidance.
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"]
    }
  }
});

// Throttles login attempts per IP — the seeded Pilot accounts all currently share one
// passcode (see seed.js), which makes brute-forcing trivial without this in place.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — please try again in a few minutes' }
});

const PASSWORD_CHANGE_ALLOWED_PATHS = ['/api/auth/me', '/api/auth/change-password'];

// Throttles guesses at the "current passcode" on the change-password endpoint.
export const passwordChangeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please try again in a few minutes' }
});

export const validatePayload = (requiredFields) => {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON request payload body' });
    }

    const missing = requiredFields.filter(field => req.body[field] === undefined || req.body[field] === null || req.body[field] === '');
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required payload fields: ${missing.join(', ')}`,
        missingFields: missing
      });
    }

    next();
  };
};

/**
 * Verifies the JWT Bearer token and attaches the authenticated identity to req.user.
 * req.user is the ONLY source of truth for role/region/sector scoping downstream —
 * routes must never trust role/region/sector supplied via query/body params.
 */
export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    // Pin the algorithm so a token can never be accepted under a weaker/unexpected one.
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = payload;

    // A token minted while the account still has its initial passcode (mcp = "must change
    // password") may only be used to read the profile and to set a new passcode.
    if (payload.mcp === true) {
      const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
      if (!PASSWORD_CHANGE_ALLOWED_PATHS.includes(path)) {
        return res.status(403).json({
          error: 'You must change your initial passcode before continuing',
          code: 'PASSWORD_CHANGE_REQUIRED'
        });
      }
    }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
};

/**
 * Restricts a route to a fixed set of roles (checked AFTER authenticate).
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource' });
    }
    next();
  };
};
