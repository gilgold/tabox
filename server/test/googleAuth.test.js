import { describe, it, expect, vi } from 'vitest';
import { verifyGoogleToken } from '../src/googleAuth.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const okJson = (body) => ({ ok: true, json: async () => body });

describe('verifyGoogleToken', () => {
  it('returns identity for a valid token with matching aud', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okJson({ aud: CLIENT_ID, expires_in: '3000' }))
      .mockResolvedValueOnce(okJson({ user: { permissionId: 'g-123', emailAddress: 'a@b.c' } }));
    expect(await verifyGoogleToken('tok', CLIENT_ID, fetchImpl)).toEqual({ googleId: 'g-123', email: 'a@b.c' });
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
