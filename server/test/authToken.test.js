import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index.js';

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? store[k] : null)),
  put: vi.fn(async (k, v) => { store[k] = v; }),
  _store: store,
});

const env = (overrides = {}) => ({
  GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'shh',
  ENTITLEMENTS: makeKV(),
  ...overrides,
});

const post = (body, headers = {}) => new Request('https://x/auth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
  body: JSON.stringify(body),
});

describe('POST /auth/token', () => {
  it('exchanges an authorization code via Google and passes the response through', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ status: 200, json: async () => ({ access_token: 'at', refresh_token: 'rt' }) });
    const res = await worker.fetch(post({
      grant_type: 'authorization_code', code: 'c0de', redirect_uri: 'https://abc.chromiumapp.org/',
    }), env());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ access_token: 'at', refresh_token: 'rt' });
    const sent = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(sent.client_secret).toBe('shh');
    expect(sent.client_id).toBe('cid.apps.googleusercontent.com');
  });

  it('passes Google invalid_grant errors through with status 400', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ status: 400, json: async () => ({ error: 'invalid_grant' }) });
    const res = await worker.fetch(post({ grant_type: 'refresh_token', refresh_token: 'expired' }), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects malformed bodies without calling Google', async () => {
    globalThis.fetch = vi.fn();
    const raw = new Request('https://x/auth/token', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' }, body: 'not-json' });
    expect((await worker.fetch(raw, env())).status).toBe(400);
    expect((await worker.fetch(post({ grant_type: 'password' }), env())).status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns 500 not_configured when GOOGLE_CLIENT_SECRET is missing', async () => {
    globalThis.fetch = vi.fn();
    const res = await worker.fetch(post({ grant_type: 'refresh_token', refresh_token: 'rt' }), env({ GOOGLE_CLIENT_SECRET: undefined }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'not_configured' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rate-limits per IP after 30 requests/minute', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ access_token: 'at' }) });
    const e = env();
    for (let i = 0; i < 30; i++) {
      expect((await worker.fetch(post({ grant_type: 'refresh_token', refresh_token: 'rt' }), e)).status).toBe(200);
    }
    const res = await worker.fetch(post({ grant_type: 'refresh_token', refresh_token: 'rt' }), e);
    expect(res.status).toBe(429);
    // a different IP is unaffected
    const other = await worker.fetch(post({ grant_type: 'refresh_token', refresh_token: 'rt' }, { 'CF-Connecting-IP': '5.6.7.8' }), e);
    expect(other.status).toBe(200);
  });

  it('accepts a redirect_uri equal to this worker origin + /auth/callback (Firefox flow)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ status: 200, json: async () => ({ access_token: 'at' }) });
    const res = await worker.fetch(post({
      grant_type: 'authorization_code', code: 'c0de', redirect_uri: 'https://x/auth/callback',
    }), env());
    expect(res.status).toBe(200);
  });

  it('rejects a redirect_uri claiming a different origin than this worker', async () => {
    globalThis.fetch = vi.fn();
    const res = await worker.fetch(post({
      grant_type: 'authorization_code', code: 'c0de', redirect_uri: 'https://evil.com/auth/callback',
    }), env());
    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /auth/callback', () => {
  function b64uEncode(obj) {
    return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  it('redirects with code + original state for a valid allizom target', async () => {
    const state = b64uEncode({ t: 'https://abc.extensions.allizom.org/', n: 'nonce' });
    const res = await worker.fetch(
      new Request(`https://x/auth/callback?code=c0de&state=${encodeURIComponent(state)}`),
      env()
    );
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location'));
    expect(loc.origin + loc.pathname).toBe('https://abc.extensions.allizom.org/');
    expect(loc.searchParams.get('code')).toBe('c0de');
    expect(loc.searchParams.get('state')).toBe(state);
  });

  it('rejects an open-redirect attempt with 400 instead of redirecting', async () => {
    const state = b64uEncode({ t: 'https://evil.com/', n: 'nonce' });
    const res = await worker.fetch(
      new Request(`https://x/auth/callback?code=c0de&state=${encodeURIComponent(state)}`),
      env()
    );
    expect(res.status).toBe(400);
  });
});
