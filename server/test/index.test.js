import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index.js';

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
  _store: store,
});

const ENV_BASE = {
  GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
  PRICE_MONTHLY: 'pri_m', PRICE_ANNUAL: 'pri_a',
  PADDLE_WEBHOOK_SECRET: 'whsec_test', JWT_SECRET: 'jwt_secret',
};

const okJson = (body) => ({ ok: true, json: async () => body });
function mockGoogleOk() {
  globalThis.fetch = vi.fn()
    .mockResolvedValueOnce(okJson({ aud: ENV_BASE.GOOGLE_CLIENT_ID }))
    .mockResolvedValueOnce(okJson({ user: { permissionId: 'g-123', emailAddress: 'a@b.c' } }));
}

async function signWebhook(body, secret, ts) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('GET /entitlement', () => {
  it('401s without a bearer token', async () => {
    const res = await worker.fetch(new Request('https://x/entitlement'), { ...ENV_BASE, ENTITLEMENTS: makeKV() });
    expect(res.status).toBe(401);
  });

  it('returns entitled=false with no KV record', async () => {
    mockGoogleOk();
    const res = await worker.fetch(
      new Request('https://x/entitlement', { headers: { Authorization: 'Bearer tok' } }),
      { ...ENV_BASE, ENTITLEMENTS: makeKV() }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await res.json();
    expect(body.entitled).toBe(false);
    expect(body.token).toBeNull();
  });

  it('returns entitled record with signed token for active subscriber', async () => {
    mockGoogleOk();
    const kv = makeKV({ 'ent:g-123': { status: 'active', plan: 'monthly', current_period_end: '2099-01-01T00:00:00Z' } });
    const res = await worker.fetch(
      new Request('https://x/entitlement', { headers: { Authorization: 'Bearer tok' } }),
      { ...ENV_BASE, ENTITLEMENTS: kv }
    );
    const body = await res.json();
    expect(body).toMatchObject({ entitled: true, status: 'active', plan: 'monthly', expiresAt: '2099-01-01T00:00:00Z' });
    expect(body.token.split('.')).toHaveLength(3);
    expect(typeof body.checkedAt).toBe('string');
  });

  it('returns entitled=false (not a 500) for a corrupt KV record', async () => {
    mockGoogleOk();
    const kv = { get: vi.fn(async () => 'corrupt{{'), put: vi.fn() };
    const res = await worker.fetch(
      new Request('https://x/entitlement', { headers: { Authorization: 'Bearer tok' } }),
      { ...ENV_BASE, ENTITLEMENTS: kv }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entitled).toBe(false);
    expect(body.token).toBeNull();
  });
});

describe('POST /webhooks/paddle', () => {
  const event = {
    event_id: 'evt_1', event_type: 'subscription.created', occurred_at: '2026-07-16T10:00:00Z',
    data: {
      id: 'sub_1', status: 'trialing', customer_id: 'ctm_1',
      custom_data: { googleId: 'g-123' },
      current_billing_period: { ends_at: '2026-07-23T10:00:00Z' },
      items: [{ price: { id: 'pri_m' } }],
    },
  };

  it('401s on bad signature', async () => {
    const res = await worker.fetch(
      new Request('https://x/webhooks/paddle', { method: 'POST', body: JSON.stringify(event), headers: { 'Paddle-Signature': 'ts=1;h1=bad' } }),
      { ...ENV_BASE, ENTITLEMENTS: makeKV() }
    );
    expect(res.status).toBe(401);
  });

  it('upserts KV on a valid signed subscription event', async () => {
    const body = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const h1 = await signWebhook(body, ENV_BASE.PADDLE_WEBHOOK_SECRET, ts);
    const kv = makeKV();
    const res = await worker.fetch(
      new Request('https://x/webhooks/paddle', { method: 'POST', body, headers: { 'Paddle-Signature': `ts=${ts};h1=${h1}` } }),
      { ...ENV_BASE, ENTITLEMENTS: kv }
    );
    expect(res.status).toBe(200);
    expect(kv._store['ent:g-123']).toMatchObject({ status: 'trialing', plan: 'monthly', subscription_id: 'sub_1' });
  });

  it('returns 200 without writing KV for a validly-signed malformed body', async () => {
    const body = 'not-json{{';
    const ts = Math.floor(Date.now() / 1000);
    const h1 = await signWebhook(body, ENV_BASE.PADDLE_WEBHOOK_SECRET, ts);
    const kv = makeKV();
    const res = await worker.fetch(
      new Request('https://x/webhooks/paddle', { method: 'POST', body, headers: { 'Paddle-Signature': `ts=${ts};h1=${h1}` } }),
      { ...ENV_BASE, ENTITLEMENTS: kv }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('ignores stale out-of-order events', async () => {
    const stale = { ...event, occurred_at: '2026-07-16T08:00:00Z' };
    const body = JSON.stringify(stale);
    const ts = Math.floor(Date.now() / 1000);
    const h1 = await signWebhook(body, ENV_BASE.PADDLE_WEBHOOK_SECRET, ts);
    const kv = makeKV({ 'ent:g-123': { status: 'active', occurred_at: '2026-07-16T09:00:00Z' } });
    const res = await worker.fetch(
      new Request('https://x/webhooks/paddle', { method: 'POST', body, headers: { 'Paddle-Signature': `ts=${ts};h1=${h1}` } }),
      { ...ENV_BASE, ENTITLEMENTS: kv }
    );
    expect(res.status).toBe(200);
    expect(kv._store['ent:g-123'].status).toBe('active');
  });
});

describe('unknown route', () => {
  it('404s', async () => {
    const res = await worker.fetch(new Request('https://x/nope'), { ...ENV_BASE, ENTITLEMENTS: makeKV() });
    expect(res.status).toBe(404);
  });
});
