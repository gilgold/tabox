import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { JOIN_PAGE_HTML } from '../src/joinPage.js';
import { makeDB } from './helpers/d1Mock.js';

describe('GET /join/:token', () => {
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
});
