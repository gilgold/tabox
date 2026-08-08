import { describe, it, expect, vi } from 'vitest';
import { verifyGoogleToken, exchangeGoogleToken, sanitizePhotoLink, isExtensionRedirect } from '../src/googleAuth.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const okJson = (body) => ({ ok: true, json: async () => body });

describe('verifyGoogleToken', () => {
  it('returns identity for a valid token with matching aud', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okJson({ aud: CLIENT_ID, expires_in: '3000' }))
      .mockResolvedValueOnce(okJson({ user: { permissionId: 'g-123', emailAddress: 'a@b.c', displayName: '  Amy Example  ', photoLink: 'https://lh3.googleusercontent.com/a/pic' } }));
    expect(await verifyGoogleToken('tok', CLIENT_ID, fetchImpl)).toEqual({
      googleId: 'g-123', email: 'a@b.c', firstName: 'Amy', photoLink: 'https://lh3.googleusercontent.com/a/pic',
    });
    expect(fetchImpl.mock.calls[0][0]).toContain('tokeninfo?access_token=tok');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });

  it('rejects a token minted for another app (aud mismatch)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okJson({ aud: 'evil-client' }));
    expect(await verifyGoogleToken('tok', CLIENT_ID, fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects when tokeninfo or about fails', async () => {
    expect(await verifyGoogleToken('tok', CLIENT_ID, vi.fn().mockResolvedValueOnce({ ok: false }))).toBeNull();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okJson({ aud: CLIENT_ID }))
      .mockResolvedValueOnce({ ok: false });
    expect(await verifyGoogleToken('tok', CLIENT_ID, fetchImpl)).toBeNull();
  });

  it('rejects when about has no permissionId', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okJson({ aud: CLIENT_ID }))
      .mockResolvedValueOnce(okJson({ user: {} }));
    expect(await verifyGoogleToken('tok', CLIENT_ID, fetchImpl)).toBeNull();
  });

  it('resolves null when fetch rejects (network error)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    await expect(verifyGoogleToken('tok', CLIENT_ID, fetchImpl)).resolves.toBeNull();
  });

  it('resolves null when tokeninfo body is malformed (json() rejects)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('bad json'); } });
    await expect(verifyGoogleToken('tok', CLIENT_ID, fetchImpl)).resolves.toBeNull();
  });
});

describe('sanitizePhotoLink', () => {
  it('accepts plain https URLs', () => {
    expect(sanitizePhotoLink('https://lh3.googleusercontent.com/a/pic=s64')).toBe('https://lh3.googleusercontent.com/a/pic=s64');
  });

  it('rejects non-https, malformed, oversized, and non-string values', () => {
    expect(sanitizePhotoLink('http://lh3.googleusercontent.com/a/pic')).toBeNull();
    expect(sanitizePhotoLink('javascript:alert(1)')).toBeNull();
    expect(sanitizePhotoLink('not a url')).toBeNull();
    expect(sanitizePhotoLink(`https://x.com/${'a'.repeat(500)}`)).toBeNull();
    expect(sanitizePhotoLink(undefined)).toBeNull();
    expect(sanitizePhotoLink(123)).toBeNull();
  });
});

const CREDS = { clientId: CLIENT_ID, clientSecret: 'shh' };

describe('exchangeGoogleToken', () => {
  it('exchanges an authorization code, forwarding client credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ status: 200, json: async () => ({ access_token: 'at', refresh_token: 'rt' }) });
    const r = await exchangeGoogleToken(
      { grant_type: 'authorization_code', code: 'c0de', redirect_uri: 'https://abc.chromiumapp.org/' },
      CREDS, fetchImpl
    );
    expect(r).toEqual({ status: 200, body: { access_token: 'at', refresh_token: 'rt' } });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent).toEqual({
      grant_type: 'authorization_code', code: 'c0de', redirect_uri: 'https://abc.chromiumapp.org/',
      client_id: CLIENT_ID, client_secret: 'shh',
    });
  });

  it('exchanges a refresh token', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ status: 200, json: async () => ({ access_token: 'at2', expires_in: 3600 }) });
    const r = await exchangeGoogleToken({ grant_type: 'refresh_token', refresh_token: 'rt' }, CREDS, fetchImpl);
    expect(r.status).toBe(200);
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: CLIENT_ID, client_secret: 'shh' });
  });

  it('passes Google error status/body through (invalid_grant)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ status: 400, json: async () => ({ error: 'invalid_grant' }) });
    const r = await exchangeGoogleToken({ grant_type: 'refresh_token', refresh_token: 'expired' }, CREDS, fetchImpl);
    expect(r).toEqual({ status: 400, body: { error: 'invalid_grant' } });
  });

  it('rejects unknown grant types and missing fields without calling Google', async () => {
    const fetchImpl = vi.fn();
    for (const params of [
      { grant_type: 'password' },
      { grant_type: 'authorization_code', code: '', redirect_uri: 'https://abc.chromiumapp.org/' },
      { grant_type: 'authorization_code', code: 'c' }, // no redirect_uri
      { grant_type: 'refresh_token' },
      null,
    ]) {
      expect(await exchangeGoogleToken(params, CREDS, fetchImpl)).toEqual({ status: 400, body: { error: 'invalid_request' } });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects redirect_uri outside *.chromiumapp.org', async () => {
    const fetchImpl = vi.fn();
    for (const uri of ['https://evil.com/', 'https://xchromiumapp.org/', 'http://abc.chromiumapp.org/', 'not-a-url']) {
      expect(await exchangeGoogleToken(
        { grant_type: 'authorization_code', code: 'c', redirect_uri: uri }, CREDS, fetchImpl
      )).toEqual({ status: 400, body: { error: 'invalid_request' } });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 502 upstream_error when fetch rejects or body is malformed', async () => {
    expect(await exchangeGoogleToken({ grant_type: 'refresh_token', refresh_token: 'rt' }, CREDS,
      vi.fn().mockRejectedValue(new Error('network')))).toEqual({ status: 502, body: { error: 'upstream_error' } });
    expect(await exchangeGoogleToken({ grant_type: 'refresh_token', refresh_token: 'rt' }, CREDS,
      vi.fn().mockResolvedValueOnce({ status: 200, json: async () => { throw new Error('bad'); } })))
      .toEqual({ status: 502, body: { error: 'upstream_error' } });
  });

  it('accepts the worker-callback redirect_uri (selfOrigin + /auth/callback) for Firefox', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ status: 200, json: async () => ({ access_token: 'at' }) });
    const creds = { ...CREDS, selfOrigin: 'https://share.tbxpro.app' };
    const r = await exchangeGoogleToken(
      { grant_type: 'authorization_code', code: 'c0de', redirect_uri: 'https://share.tbxpro.app/auth/callback' },
      creds, fetchImpl
    );
    expect(r).toEqual({ status: 200, body: { access_token: 'at' } });
  });

  it('still accepts chromiumapp redirects when selfOrigin is set, and rejects a foreign origin masquerading as /auth/callback', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ access_token: 'at' }) });
    const creds = { ...CREDS, selfOrigin: 'https://share.tbxpro.app' };
    expect((await exchangeGoogleToken(
      { grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://abc.chromiumapp.org/' }, creds, fetchImpl
    )).status).toBe(200);
    expect(await exchangeGoogleToken(
      { grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://evil.com/auth/callback' }, creds, fetchImpl
    )).toEqual({ status: 400, body: { error: 'invalid_request' } });
  });
});

describe('isExtensionRedirect', () => {
  it('accepts *.chromiumapp.org regardless of selfOrigin', () => {
    expect(isExtensionRedirect('https://abc.chromiumapp.org/')).toBe(true);
    expect(isExtensionRedirect('https://abc.chromiumapp.org/', 'https://share.tbxpro.app')).toBe(true);
  });

  it('accepts exactly selfOrigin + /auth/callback', () => {
    expect(isExtensionRedirect('https://share.tbxpro.app/auth/callback', 'https://share.tbxpro.app')).toBe(true);
  });

  it('rejects selfOrigin + /auth/callback when selfOrigin is not provided', () => {
    expect(isExtensionRedirect('https://share.tbxpro.app/auth/callback')).toBe(false);
  });

  it('rejects near-misses of the callback path and other origins', () => {
    const selfOrigin = 'https://share.tbxpro.app';
    expect(isExtensionRedirect('https://share.tbxpro.app/auth/callback/', selfOrigin)).toBe(false);
    expect(isExtensionRedirect('https://share.tbxpro.app/auth/callback2', selfOrigin)).toBe(false);
    expect(isExtensionRedirect('https://evil.com/auth/callback', selfOrigin)).toBe(false);
    expect(isExtensionRedirect('http://share.tbxpro.app/auth/callback', selfOrigin)).toBe(false);
  });

  it('rejects non-string and malformed input', () => {
    expect(isExtensionRedirect(undefined)).toBe(false);
    expect(isExtensionRedirect('not-a-url')).toBe(false);
  });
});
