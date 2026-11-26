import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import spec from '../docs/openapi.js';

/** The Swagger page and the OpenAPI file must exist and must not drift from the real routes. */

/** Mount path of a router layer, e.g. /^\/api\/auth\/?(?=\/|$)/i -> /api/auth */
const mountPath = (layer) =>
  layer.regexp.source.replace('^\\', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');

/** Every "method /path" the running app answers, with :id turned into {id}. */
const mountedRoutes = () => {
  const found = new Set();
  for (const layer of app._router.stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) found.add(`${method} ${layer.route.path}`);
    } else if (layer.name === 'router') {
      const base = mountPath(layer);
      for (const inner of layer.handle.stack) {
        if (!inner.route) continue;
        const path = (base + (inner.route.path === '/' ? '' : inner.route.path)).replace(/:(\w+)/g, '{$1}');
        for (const method of Object.keys(inner.route.methods)) found.add(`${method} ${path}`);
      }
    }
  }
  return found;
};

/** Every "method /path" the OpenAPI file describes. */
const documentedRoutes = () => {
  const found = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) found.add(`${method} ${path}`);
  }
  return found;
};

describe('API documentation', () => {
  it('serves the Swagger UI page', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('swagger-ui');
  });

  it('serves the OpenAPI document as JSON', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(30);
  });

  it('documents every route the API serves', () => {
    const documented = documentedRoutes();
    // The docs endpoint itself is not part of the API being described.
    const missing = [...mountedRoutes()].filter((r) => r !== 'get /api/openapi.json' && !documented.has(r));
    expect(missing).toEqual([]);
  });

  it('does not document a route that no longer exists', () => {
    const mounted = mountedRoutes();
    const extra = [...documentedRoutes()].filter((r) => !mounted.has(r));
    expect(extra).toEqual([]);
  });

  it('requires a token on every operation except sign-in and health', () => {
    const open = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!operation.security) open.push(`${method} ${path}`);
      }
    }
    expect(open.sort()).toEqual(['get /api/health', 'post /api/auth/login']);
  });
});
