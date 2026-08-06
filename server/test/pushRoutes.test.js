import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index.js';
import { makeDB } from './helpers/d1Mock.js';
import { handlePushSubscribe, handlePushUnsubscribe } from '../src/pushRoutes.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const NOW = 1000;
const sub = (n) => ({
  endpoint: `https://push.example.com/ep${n}`,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

async function countForEmail(db, email) {
  const row = await db.prepare('SELECT COUNT(*) as c FROM push_subscriptions WHERE user_email = ?').bind(email).first();
  return row.c;
}

describe('handlePushSubscribe', () => {
  it('upserts a row keyed by endpoint for the caller\'s lowercased email', async () => {
    const db = makeDB();
    const res = await handlePushSubscribe(db, OWNER, sub(1), NOW);
    expect(res).toEqual({ ok: true, data: {} });
    const row = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(sub(1).endpoint).first();
    expect(row).toMatchObject({
      endpoint: sub(1).endpoint,
      user_email: 'owner@x.com',
      p256dh: 'p256dh-1',
      auth: 'auth-1',
      created_at: NOW,
    });
  });

  it('re-subscribing the same endpoint after an email case change updates the row, count stays 1', async () => {
    const db = makeDB();
    await handlePushSubscribe(db, { googleId: 'g-owner', email: 'Owner@X.com' }, sub(1), NOW);
    const res = await handlePushSubscribe(db, { googleId: 'g-owner', email: 'owner@x.com' }, { ...sub(1), keys: { p256dh: 'p256dh-new', auth: 'auth-new' } }, NOW + 1);
    expect(res).toEqual({ ok: true, data: {} });
    expect(await countForEmail(db, 'owner@x.com')).toBe(1);
    const row = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(sub(1).endpoint).first();
    expect(row.p256dh).toBe('p256dh-new');
    expect(row.auth).toBe('auth-new');
  });

  describe('invalid bodies', () => {
    const cases = [
      ['missing endpoint', { keys: { p256dh: 'p', auth: 'a' } }],
      ['endpoint not https:// URL', { endpoint: 'http://push.example.com/ep', keys: { p256dh: 'p', auth: 'a' } }],
      ['missing keys.p256dh', { endpoint: 'https://push.example.com/ep', keys: { auth: 'a' } }],
      ['missing keys.auth', { endpoint: 'https://push.example.com/ep', keys: { p256dh: 'p' } }],
      ['endpoint > 1024 chars', { endpoint: `https://push.example.com/${'e'.repeat(1025)}`, keys: { p256dh: 'p', auth: 'a' } }],
      ['p256dh > 256 chars', { endpoint: 'https://push.example.com/ep', keys: { p256dh: 'p'.repeat(257), auth: 'a' } }],
      ['auth > 256 chars', { endpoint: 'https://push.example.com/ep', keys: { p256dh: 'p', auth: 'a'.repeat(257) } }],
    ];
    it.each(cases)('rejects: %s', async (_label, body) => {
      const db = makeDB();
      const res = await handlePushSubscribe(db, OWNER, body, NOW);
      expect(res).toEqual({ ok: false, error: 'invalid_subscription', status: 400 });
    });
  });

  it('caps subscriptions at 8 per user: a 9th distinct endpoint evicts the oldest by created_at', async () => {
    const db = makeDB();
    for (let i = 1; i <= 8; i++) {
      const res = await handlePushSubscribe(db, OWNER, sub(i), NOW + i);
      expect(res.ok).toBe(true);
    }
    expect(await countForEmail(db, 'owner@x.com')).toBe(8);

    const res = await handlePushSubscribe(db, OWNER, sub(9), NOW + 9);
    expect(res).toEqual({ ok: true, data: {} });
    expect(await countForEmail(db, 'owner@x.com')).toBe(8);

    const oldest = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(sub(1).endpoint).first();
    expect(oldest).toBeNull();
    const newest = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(sub(9).endpoint).first();
    expect(newest).not.toBeNull();
  });
});

describe('handlePushUnsubscribe', () => {
  it('deletes only a row whose user_email matches the caller; a different user\'s endpoint is left intact', async () => {
    const db = makeDB();
    await handlePushSubscribe(db, OWNER, sub(1), NOW);
    const OTHER = { googleId: 'g-other', email: 'other@x.com' };
    await handlePushSubscribe(db, OTHER, sub(2), NOW);

    const res = await handlePushUnsubscribe(db, OWNER, { endpoint: sub(2).endpoint });
    expect(res).toEqual({ ok: true, data: {} });

    const otherRow = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(sub(2).endpoint).first();
    expect(otherRow).not.toBeNull();

    const own = await handlePushUnsubscribe(db, OWNER, { endpoint: sub(1).endpoint });
    expect(own).toEqual({ ok: true, data: {} });
    const ownRow = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(sub(1).endpoint).first();
    expect(ownRow).toBeNull();
  });
});

describe('route-level /push/subscribe', () => {
  const env = (db) => ({ GOOGLE_CLIENT_ID: 'cid', JWT_SECRET: 's', ENTITLEMENTS: { get: vi.fn(async () => null), put: vi.fn(async () => {}) }, SHARED_DB: db });

  function mockGoogle(identities) {
    globalThis.fetch = vi.fn(async (url, opts) => {
      const token = String(url).includes('tokeninfo')
        ? new URL(url).searchParams.get('access_token')
        : (opts?.headers?.Authorization || '').replace('Bearer ', '');
      const id = identities[token];
      if (!id) return { ok: false };
      if (String(url).includes('tokeninfo')) return { ok: true, json: async () => ({ aud: 'cid' }) };
      return { ok: true, json: async () => ({ user: { permissionId: id.googleId, emailAddress: id.email } }) };
    });
  }

  it('POST /push/subscribe without Authorization -> 401', async () => {
    const db = makeDB();
    mockGoogle({});
    const res = await worker.fetch(new Request('https://api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub(1)),
    }), env(db));
    expect(res.status).toBe(401);
  });

  it('POST /push/subscribe with a valid token -> 200', async () => {
    const db = makeDB();
    mockGoogle({ 't-owner': { googleId: 'g-owner', email: 'owner@x.com' } });
    const res = await worker.fetch(new Request('https://api/push/subscribe', {
      method: 'POST',
      headers: { Authorization: 'Bearer t-owner' },
      body: JSON.stringify(sub(1)),
    }), env(db));
    expect(res.status).toBe(200);
    const row = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(sub(1).endpoint).first();
    expect(row).not.toBeNull();
  });
});
