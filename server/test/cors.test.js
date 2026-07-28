// CORS is load-bearing for the extension since v4.2: the manifest no longer
// carries a host_permissions entry for the Worker, so every extension call
// (popup or service worker) is a plain cross-origin fetch that the browser
// only delivers because the Worker answers OPTIONS preflights and stamps
// `Access-Control-Allow-Origin: *` on every JSON response (the `json()`
// helper in src/index.js). A route that loses these headers silently breaks
// ALL Worker calls from the extension — this suite pins them down.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index.js';

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? String(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = v; }),
});

const env = (extra = {}) => ({
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csecret',
  JWT_SECRET: 's',
  ENTITLEMENTS: makeKV(),
  OPENROUTER_API_KEY: 'sk-or-secret',
  ...extra,
});

describe('CORS headers (extension has no host permission for the Worker)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('answers OPTIONS preflight with the full CORS header set on any path', async () => {
    for (const path of ['/entitlement', '/ai/complete', '/auth/token', '/shared/invites', '/subscription', '/nonexistent']) {
      const res = await worker.fetch(new Request(`https://api${path}`, { method: 'OPTIONS' }), env());
      expect(res.status, path).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin'), path).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods'), path).toContain('POST');
      expect(res.headers.get('Access-Control-Allow-Headers'), path).toContain('Authorization');
      expect(res.headers.get('Access-Control-Allow-Headers'), path).toContain('Content-Type');
    }
  });

  it('includes Access-Control-Allow-Origin: * on every JSON route response', async () => {
    // No network mocking needed: unauthenticated requests short-circuit before
    // any upstream call, but still flow through the shared json() helper.
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));

    const cases = [
      ['GET /entitlement (401)', new Request('https://api/entitlement')],
      ['POST /ai/complete (401)', new Request('https://api/ai/complete', { method: 'POST', body: '{}' })],
      ['GET /subscription (401)', new Request('https://api/subscription')],
      ['POST /subscription/cancel (401)', new Request('https://api/subscription/cancel', { method: 'POST', body: '{}' })],
      ['POST /auth/token (bad body)', new Request('https://api/auth/token', { method: 'POST', body: 'not-json' })],
      ['unknown route (404)', new Request('https://api/definitely/not/a/route')],
    ];

    for (const [label, request] of cases) {
      const res = await worker.fetch(request, env());
      expect(res.headers.get('Content-Type'), label).toContain('application/json');
      expect(res.headers.get('Access-Control-Allow-Origin'), label).toBe('*');
    }
  });

  it('keeps ACAO * on an authenticated success response (entitlement)', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('tokeninfo')) return { ok: true, json: async () => ({ aud: 'cid' }) };
      return { ok: true, json: async () => ({ user: { permissionId: 'g-user', emailAddress: 'u@x.com' } }) };
    });
    const res = await worker.fetch(
      new Request('https://api/entitlement', { headers: { Authorization: 'Bearer t-user' } }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
