import { describe, it, expect } from 'vitest';
import { Script } from 'node:vm';
import worker from '../src/index.js';
import { JOIN_PAGE_HTML } from '../src/joinPage.js';
import { makeDB } from './helpers/d1Mock.js';

describe('GET /join/:token', () => {
  it('emits executable JavaScript for the join page', () => {
    const script = JOIN_PAGE_HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
    expect(() => new Script(script)).not.toThrow();
  });
  it('serves the static join page as HTML without auth', async () => {
    const res = await worker.fetch(
      new Request('https://api/join/sometoken'),
      { GOOGLE_CLIENT_ID: 'cid', ENTITLEMENTS: { get: async () => null, put: async () => {} }, SHARED_DB: makeDB() }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toBe(JOIN_PAGE_HTML);
    expect(html).toContain('taboxShareLink');
    expect(html).toContain('bdbliblipiempfdkkkjohnecmeknnpoa');
    expect(html).not.toContain('sometoken'); // static template, token never interpolated
  });

  it('falls back to the legacy workers.dev origin when the handshake fails off it (pre-4.3 installs only allow that origin in externally_connectable)', () => {
    expect(JOIN_PAGE_HTML).toContain("var LEGACY_ORIGIN = 'https://tabox-api.gilgold13.workers.dev'");
    // The hop must be origin-guarded (loop protection) and re-encode the token.
    expect(JOIN_PAGE_HTML).toContain('if (location.origin !== LEGACY_ORIGIN)');
    expect(JOIN_PAGE_HTML).toContain("location.replace(LEGACY_ORIGIN + '/join/' + encodeURIComponent(token))");
  });

  it('separates install detection (ping) from the redeem, which gets a long timeout', () => {
    // Ping decides installed-vs-not; the redeem may take seconds (cold SW +
    // network + join) and must never be mistaken for "not installed".
    expect(JOIN_PAGE_HTML).toContain('taboxShareLinkPing');
    expect(JOIN_PAGE_HTML).toContain('REDEEM_TIMEOUT_MS = 30000');
  });
});
