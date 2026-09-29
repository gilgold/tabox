import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { signPurposeToken, verifyPurposeToken, signEntitlementToken } from '../src/jwt.js';
import { isPaymentFailedEvent, sentKey, notifyPaymentFailed } from '../src/paymentFailedNotify.js';
import { paymentFailedEmail } from '../src/paymentFailedEmail.js';

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
  delete: vi.fn(async (k) => { delete store[k]; }),
  _store: store,
});

const ENV_BASE = {
  PRICE_MONTHLY: 'pri_m', PRICE_ANNUAL: 'pri_a',
  PADDLE_WEBHOOK_SECRET: 'whsec_test', JWT_SECRET: 'jwt_secret',
  PADDLE_API_BASE: 'https://paddle.test', PADDLE_API_KEY: 'pdl_key',
  PADDLE_PORTAL_URL: 'https://customer-portal.paddle.com/cpl_test',
  RESEND_API_KEY: 're_test',
};
const PRICE_MAP = { monthly: 'pri_m', annual: 'pri_a' };

const pastDueEvent = {
  event_id: 'evt_pd', event_type: 'subscription.past_due', occurred_at: '2026-09-28T13:10:21Z',
  data: {
    id: 'sub_1', status: 'past_due', customer_id: 'ctm_1', collection_mode: 'automatic',
    current_billing_period: { starts_at: '2026-09-28T13:09:45Z', ends_at: '2027-09-28T13:09:45Z' },
    items: [{ price: { id: 'pri_a' } }],
  },
};

const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

// Routes fetch by URL so tests don't depend on call order.
function mockFetch({ customer = { email: 'dana@example.com', name: 'Dana Levi' }, resendStatus = 200, subscription } = {}) {
  globalThis.fetch = vi.fn(async (input) => {
    const u = String(input);
    if (u === 'https://paddle.test/customers/ctm_1') return customer ? res(200, { data: customer }) : res(404, { error: { code: 'not_found' } });
    if (u === 'https://api.resend.com/emails') return res(resendStatus, { id: 'em_1' });
    if (u === 'https://paddle.test/subscriptions/sub_1') return subscription ? res(200, { data: subscription }) : res(404, { error: { code: 'not_found' } });
    throw new Error(`unexpected fetch ${u}`);
  });
}
const resendCalls = () => globalThis.fetch.mock.calls.filter(([u]) => String(u) === 'https://api.resend.com/emails');

describe('purpose tokens', () => {
  it('round-trips and rejects wrong purpose, tampering and expiry', async () => {
    const now = Date.parse('2026-09-29T00:00:00Z');
    const t = await signPurposeToken('update-pm', { sid: 'sub_1' }, 's', 60, now);
    expect((await verifyPurposeToken('update-pm', t, 's', now)).sid).toBe('sub_1');
    expect(await verifyPurposeToken('other', t, 's', now)).toBeNull();
    expect(await verifyPurposeToken('update-pm', t, 'wrong', now)).toBeNull();
    expect(await verifyPurposeToken('update-pm', t, 's', now + 61_000)).toBeNull();
    const [h, , sig] = t.split('.');
    const forged = btoa(JSON.stringify({ sid: 'sub_2', pur: 'update-pm', exp: 9e9 })).replace(/=+$/, '');
    expect(await verifyPurposeToken('update-pm', `${h}.${forged}.${sig}`, 's', now)).toBeNull();
    expect(await verifyPurposeToken('update-pm', 'garbage', 's', now)).toBeNull();
  });

  it('does not accept an entitlement token', async () => {
    const t = await signEntitlementToken({ sub: 'g-1', sid: 'sub_1' }, 's');
    expect(await verifyPurposeToken('update-pm', t, 's')).toBeNull();
  });
});

describe('isPaymentFailedEvent / sentKey', () => {
  it('matches only automatic past_due subscriptions', () => {
    expect(isPaymentFailedEvent(pastDueEvent)).toBe(true);
    expect(isPaymentFailedEvent({ ...pastDueEvent, event_type: 'subscription.updated' })).toBe(false);
    expect(isPaymentFailedEvent({ ...pastDueEvent, data: { ...pastDueEvent.data, status: 'active' } })).toBe(false);
    expect(isPaymentFailedEvent({ ...pastDueEvent, data: { ...pastDueEvent.data, collection_mode: 'manual' } })).toBe(false);
  });

  it('keys by subscription + unpaid period start', () => {
    expect(sentKey(pastDueEvent.data)).toBe('pmfail:sub_1:2026-09-28T13:09:45Z');
  });
});

describe('notifyPaymentFailed', () => {
  beforeEach(() => mockFetch());

  it('sends one email to the Paddle customer with a Worker redirect link', async () => {
    const kv = makeKV();
    const out = await notifyPaymentFailed({ ...ENV_BASE, ENTITLEMENTS: kv }, pastDueEvent, 'https://api.test', PRICE_MAP);
    expect(out).toEqual({ sent: true });
    const [[, init]] = resendCalls();
    expect(init.headers.Authorization).toBe('Bearer re_test');
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({ from: 'Tabox <info@tabox.co>', to: ['dana@example.com'], reply_to: 'info@tabox.co' });
    expect(payload.subject).toBe("Your Tabox Pro payment didn't go through");
    expect(payload.text).toContain('Hi Dana');
    expect(payload.text).toContain('annual Tabox Pro plan');
    const link = payload.text.match(/https:\/\/api\.test\/billing\/payment-method\?t=\S+/)[0];
    const t = decodeURIComponent(new URL(link).searchParams.get('t'));
    expect((await verifyPurposeToken('update-pm', t, 'jwt_secret')).sid).toBe('sub_1');
    expect(kv._store['pmfail:sub_1:2026-09-28T13:09:45Z']).toBeTruthy();
  });

  it('does not send twice for the same failed period', async () => {
    const kv = makeKV();
    const env = { ...ENV_BASE, ENTITLEMENTS: kv };
    await notifyPaymentFailed(env, pastDueEvent, 'https://api.test', PRICE_MAP);
    const second = await notifyPaymentFailed(env, pastDueEvent, 'https://api.test', PRICE_MAP);
    expect(second).toEqual({ sent: false, reason: 'already_sent' });
    expect(resendCalls()).toHaveLength(1);
  });

  it('does not mark as sent when Resend fails, so a redelivery retries', async () => {
    mockFetch({ resendStatus: 500 });
    const kv = makeKV();
    const out = await notifyPaymentFailed({ ...ENV_BASE, ENTITLEMENTS: kv }, pastDueEvent, 'https://api.test', PRICE_MAP);
    expect(out).toEqual({ sent: false, reason: 'error' });
    expect(Object.keys(kv._store)).toHaveLength(0);
  });

  it('skips without a customer email or without a Resend key', async () => {
    mockFetch({ customer: null });
    expect(await notifyPaymentFailed({ ...ENV_BASE, ENTITLEMENTS: makeKV() }, pastDueEvent, 'https://api.test', PRICE_MAP))
      .toEqual({ sent: false, reason: 'no_email' });
    expect(await notifyPaymentFailed({ ...ENV_BASE, RESEND_API_KEY: undefined, ENTITLEMENTS: makeKV() }, pastDueEvent, 'https://api.test', PRICE_MAP))
      .toEqual({ sent: false, reason: 'no_resend_key' });
    expect(resendCalls()).toHaveLength(0);
  });
});

describe('POST /webhooks/paddle — subscription.past_due', () => {
  async function signWebhook(body, secret, ts) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${body}`));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('acks and schedules the email via waitUntil', async () => {
    mockFetch();
    const body = JSON.stringify(pastDueEvent);
    const ts = Math.floor(Date.now() / 1000);
    const h1 = await signWebhook(body, ENV_BASE.PADDLE_WEBHOOK_SECRET, ts);
    const pending = [];
    const ctx = { waitUntil: (p) => pending.push(p) };
    const r = await worker.fetch(
      new Request('https://api.test/webhooks/paddle', { method: 'POST', body, headers: { 'Paddle-Signature': `ts=${ts};h1=${h1}` } }),
      { ...ENV_BASE, ENTITLEMENTS: makeKV() },
      ctx
    );
    expect(r.status).toBe(200);
    expect(pending).toHaveLength(1);
    expect(await pending[0]).toEqual({ sent: true });
  });
});

describe('GET /billing/payment-method', () => {
  const go = (t) => worker.fetch(new Request(`https://api.test/billing/payment-method${t ? `?t=${encodeURIComponent(t)}` : ''}`), { ...ENV_BASE, ENTITLEMENTS: makeKV() });

  it('redirects to a fresh Paddle update_payment_method link', async () => {
    const fresh = 'https://customer-portal.paddle.com/cpl_test/subscriptions/sub_1/update-payment-method?token=abc';
    mockFetch({ subscription: { id: 'sub_1', management_urls: { update_payment_method: fresh } } });
    const t = await signPurposeToken('update-pm', { sid: 'sub_1' }, 'jwt_secret', 60);
    const r = await go(t);
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe(fresh);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const [[, init]] = globalThis.fetch.mock.calls;
    expect(init.headers.Authorization).toBe('Bearer pdl_key');
  });

  it('falls back to the customer portal for bad tokens or Paddle errors', async () => {
    mockFetch({ subscription: null });
    expect((await go('nope')).headers.get('Location')).toBe('https://customer-portal.paddle.com/cpl_test');
    expect((await go()).headers.get('Location')).toBe('https://customer-portal.paddle.com/cpl_test');
    const t = await signPurposeToken('update-pm', { sid: 'sub_1' }, 'jwt_secret', 60);
    expect((await go(t)).headers.get('Location')).toBe('https://customer-portal.paddle.com/cpl_test');
  });
});

describe('paymentFailedEmail', () => {
  it('escapes the name and falls back to "there"', () => {
    expect(paymentFailedEmail({ name: '<b>x</b>', plan: 'monthly', updatePaymentUrl: 'https://a' }).html).toContain('&lt;b&gt;x&lt;/b&gt;');
    const e = paymentFailedEmail({ name: null, plan: null, updatePaymentUrl: 'https://a' });
    expect(e.text).toContain('Hi there');
    expect(e.text).toContain('your Tabox Pro plan');
  });
});
