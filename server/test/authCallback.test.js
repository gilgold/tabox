import { describe, it, expect } from 'vitest';
import { handleAuthCallback } from '../src/authCallback.js';

function b64uEncode(obj) {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function req(query) {
  const url = new URL('https://share.tbxpro.app/auth/callback');
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

const TARGET = 'https://abc123.extensions.allizom.org/';

describe('handleAuthCallback', () => {
  it('redirects to the target with code and original state on success', async () => {
    const state = b64uEncode({ t: TARGET, n: 'nonce-1' });
    const res = await handleAuthCallback(req({ code: 'auth-code-1', state }));
    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    const loc = new URL(location);
    expect(loc.origin + loc.pathname).toBe(TARGET);
    expect(loc.searchParams.get('code')).toBe('auth-code-1');
    expect(loc.searchParams.get('state')).toBe(state);
  });

  it('sends Cache-Control: no-store on the success redirect', async () => {
    const state = b64uEncode({ t: TARGET, n: 'nonce-1' });
    const res = await handleAuthCallback(req({ code: 'auth-code-1', state }));
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sends Cache-Control: no-store on 400 responses', async () => {
    const res = await handleAuthCallback(req({}));
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('strips embedded userinfo from the target before redirecting', async () => {
    const state = b64uEncode({ t: 'https://evil.com:443@x.extensions.allizom.org/', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).not.toContain('@');
    const loc = new URL(location);
    expect(loc.hostname).toBe('x.extensions.allizom.org');
  });

  it('passes Google error through to the target instead of a code', async () => {
    const state = b64uEncode({ t: TARGET, n: 'nonce-2' });
    const res = await handleAuthCallback(req({ error: 'access_denied', state }));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location'));
    expect(loc.origin + loc.pathname).toBe(TARGET);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('code')).toBeNull();
    expect(loc.searchParams.get('state')).toBe(state);
  });

  it('never echoes state into an HTML body (302 header only)', async () => {
    const state = b64uEncode({ t: TARGET, n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    const text = await res.text();
    expect(text).not.toContain(state);
    expect(res.headers.get('Content-Type') || '').not.toMatch(/html/);
  });

  it('returns 400 when state is missing or unparseable', async () => {
    for (const state of [undefined, 'not-base64url-json!!!', btoa('not json')]) {
      const res = await handleAuthCallback(req({ code: 'c', state }));
      expect(res.status).toBe(400);
    }
  });

  it('returns 400 when neither code nor error is present', async () => {
    const state = b64uEncode({ t: TARGET, n: 'n' });
    const res = await handleAuthCallback(req({ state }));
    expect(res.status).toBe(400);
  });

  it('rejects http (non-https) targets', async () => {
    const state = b64uEncode({ t: 'http://abc123.extensions.allizom.org/', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(400);
  });

  it('rejects targets on a completely different host', async () => {
    const state = b64uEncode({ t: 'https://evil.com/', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(400);
  });

  it('rejects allizom lookalike hosts (suffix without the leading-label dot)', async () => {
    const state = b64uEncode({ t: 'https://xextensions.allizom.org/', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(400);
  });

  it('rejects hosts where the allowed domain is merely a prefix (evil-extensions.allizom.org.evil.com)', async () => {
    const state = b64uEncode({ t: 'https://evil-extensions.allizom.org.evil.com/', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(400);
  });

  it('rejects userinfo/path tricks that resolve to a different host', async () => {
    for (const t of [
      'https://abc.extensions.allizom.org@evil.com/',
      'https://evil.com/abc.extensions.allizom.org/',
      'https:evil.com',
    ]) {
      const state = b64uEncode({ t, n: 'n' });
      const res = await handleAuthCallback(req({ code: 'c', state }));
      expect(res.status).toBe(400);
    }
  });

  it('rejects the bare allowed domain with no subdomain label', async () => {
    const state = b64uEncode({ t: 'https://extensions.allizom.org/', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(400);
  });

  it('rejects the bare allowed domain used as a prefix (extensions.allizom.org.evil.com)', async () => {
    const state = b64uEncode({ t: 'https://extensions.allizom.org.evil.com/', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(400);
  });

  it('rejects a hyphen-boundary lookalike host (evil-extensions.allizom.org)', async () => {
    const state = b64uEncode({ t: 'https://evil-extensions.allizom.org/', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(400);
  });

  it('rejects the backslash form of a foreign host (https:/\\evil.com)', async () => {
    const state = b64uEncode({ t: 'https:/\\evil.com', n: 'n' });
    const res = await handleAuthCallback(req({ code: 'c', state }));
    expect(res.status).toBe(400);
  });

  it('caps state length', async () => {
    const hugeState = 'a'.repeat(3000);
    const res = await handleAuthCallback(req({ code: 'c', state: hugeState }));
    expect(res.status).toBe(400);
  });

  it('caps code length', async () => {
    const state = b64uEncode({ t: TARGET, n: 'n' });
    const hugeCode = 'a'.repeat(3000);
    const res = await handleAuthCallback(req({ code: hugeCode, state }));
    expect(res.status).toBe(400);
  });

  it('returns JSON on the 400 error path', async () => {
    const res = await handleAuthCallback(req({ code: 'c' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
