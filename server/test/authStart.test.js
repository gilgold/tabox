import { describe, it, expect } from 'vitest';
import { handleAuthStart, handleAuthDone } from '../src/authStart.js';

function b64uEncode(obj) {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function req(query) {
  const url = new URL('https://share.tbxpro.app/auth/start');
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

const TARGET = 'https://abc123.extensions.allizom.org/';
const ENV = { GOOGLE_CLIENT_ID: 'client-id-123.apps.googleusercontent.com' };

describe('handleAuthStart', () => {
  it('302s to the Google auth endpoint with the registered callback as redirect_uri and state verbatim', () => {
    const state = b64uEncode({ t: TARGET, n: 'nonce-1' });
    const res = handleAuthStart(req({ state, redirect_uri: TARGET }), ENV);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location'));
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe(ENV.GOOGLE_CLIENT_ID);
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('access_type')).toBe('offline');
    expect(loc.searchParams.get('prompt')).toBe('consent');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://share.tbxpro.app/auth/callback');
    expect(loc.searchParams.get('scope')).toBe(
      'openid https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file'
    );
    expect(loc.searchParams.get('state')).toBe(state);
  });

  it('sends Cache-Control: no-store on the redirect', () => {
    const state = b64uEncode({ t: TARGET, n: 'nonce-1' });
    const res = handleAuthStart(req({ state, redirect_uri: TARGET }), ENV);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('allows the redirect_uri param to be absent (state alone decides the target)', () => {
    const state = b64uEncode({ t: TARGET, n: 'nonce-1' });
    const res = handleAuthStart(req({ state }), ENV);
    expect(res.status).toBe(302);
  });

  it('400s when the redirect_uri param does not match the state target', () => {
    const state = b64uEncode({ t: TARGET, n: 'nonce-1' });
    const res = handleAuthStart(req({ state, redirect_uri: 'https://other.extensions.allizom.org/' }), ENV);
    expect(res.status).toBe(400);
  });

  it('400s without state', () => {
    const res = handleAuthStart(req({ redirect_uri: TARGET }), ENV);
    expect(res.status).toBe(400);
  });

  it('400s on undecodable state', () => {
    const res = handleAuthStart(req({ state: '!!not-base64url!!' }), ENV);
    expect(res.status).toBe(400);
  });

  it.each([
    ['http target', 'http://abc123.extensions.allizom.org/'],
    ['arbitrary https host', 'https://evil.com/'],
    ['allizom lookalike label', 'https://xextensions.allizom.org/'],
    ['allowed domain as prefix of attacker host', 'https://evil-extensions.allizom.org.evil.com/'],
  ])('400s when the state target is not an allizom extension origin (%s)', (_label, target) => {
    const state = b64uEncode({ t: target, n: 'n' });
    const res = handleAuthStart(req({ state, redirect_uri: target }), ENV);
    expect(res.status).toBe(400);
  });

  it('accepts its own /auth/done as the tab-flow target', () => {
    const done = 'https://share.tbxpro.app/auth/done';
    const state = b64uEncode({ t: done, n: 'n' });
    const res = handleAuthStart(req({ state, redirect_uri: done }), ENV);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('Location')).searchParams.get('redirect_uri')).toBe('https://share.tbxpro.app/auth/callback');
  });

  it("rejects a foreign origin's /auth/done", () => {
    const state = b64uEncode({ t: 'https://evil.example/auth/done', n: 'n' });
    expect(handleAuthStart(req({ state }), ENV).status).toBe(400);
  });
});

describe('handleAuthDone', () => {
  it('serves a no-store, no-referrer static page', async () => {
    const res = handleAuthDone();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await res.text()).toContain('close this tab');
  });
});
