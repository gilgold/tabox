import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { prorationModeFor, toSubscriptionDto, toPreviewDto } from '../src/subscriptionManagement.js';

const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
  _store: store,
});

const ENV_BASE = {
  GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
  PRICE_MONTHLY: 'pri_m', PRICE_ANNUAL: 'pri_a',
  PADDLE_WEBHOOK_SECRET: 'whsec_test', JWT_SECRET: 'jwt_secret',
  PADDLE_API_BASE: 'https://paddle.test', PADDLE_API_KEY: 'pdl_key',
};

const ENT_RECORD = {
  status: 'active', plan: 'monthly', current_period_end: '2026-08-01T00:00:00Z',
  subscription_id: 'sub_1', customer_id: 'ctm_1', occurred_at: '2026-07-01T00:00:00Z',
};

const PADDLE_SUB = {
  id: 'sub_1',
  status: 'active',
  customer_id: 'ctm_1',
  items: [{ price: { id: 'pri_m' } }],
  next_billed_at: '2026-08-01T00:00:00Z',
  current_billing_period: { ends_at: '2026-08-01T00:00:00Z' },
  scheduled_change: null,
  management_urls: { update_payment_method: 'https://paddle.test/pay', cancel: 'https://paddle.test/cancel' },
};

// URL-dispatching fetch mock: Google auth always succeeds; Paddle calls are
// recorded and answered from `paddleResponses` in order.
let paddleCalls;
let paddleResponses;
function mockFetch() {
  paddleCalls = [];
  paddleResponses = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    if (url.startsWith('https://www.googleapis.com/oauth2')) {
      return { ok: true, json: async () => ({ aud: ENV_BASE.GOOGLE_CLIENT_ID }) };
    }
    if (url.startsWith('https://www.googleapis.com/drive')) {
      return { ok: true, json: async () => ({ user: { permissionId: 'g-123', emailAddress: 'a@b.c' } }) };
    }
    if (url.startsWith(ENV_BASE.PADDLE_API_BASE)) {
      paddleCalls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers });
      const next = paddleResponses.shift() || { status: 200, body: { data: PADDLE_SUB } };
      return { ok: next.status < 400, status: next.status, json: async () => next.body };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const req = (path, { method = 'GET', body, token = 'tok' } = {}) =>
  new Request(`https://x${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

const envWith = (store) => ({ ...ENV_BASE, ENTITLEMENTS: makeKV(store) });

beforeEach(mockFetch);

describe('subscription management auth & resolution', () => {
  it('401s without a bearer token', async () => {
    const res = await worker.fetch(req('/subscription', { token: null }), envWith({}));
    expect(res.status).toBe(401);
  });

  it('404s when the caller has no entitlement record', async () => {
    const res = await worker.fetch(req('/subscription'), envWith({}));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('no_subscription');
    expect(paddleCalls).toHaveLength(0);
  });

  it('404s when the record has no subscription_id (corrupt/legacy)', async () => {
    const res = await worker.fetch(req('/subscription'), envWith({ 'ent:g-123': { status: 'active' } }));
    expect(res.status).toBe(404);
  });
});

describe('GET /subscription', () => {
  it('returns a slim DTO from the live Paddle subscription', async () => {
    const res = await worker.fetch(req('/subscription'), envWith({ 'ent:g-123': ENT_RECORD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      plan: 'monthly',
      status: 'active',
      next_billed_at: '2026-08-01T00:00:00Z',
      current_period_end: '2026-08-01T00:00:00Z',
      scheduled_change: null,
      update_payment_method_url: 'https://paddle.test/pay',
    });
    expect(paddleCalls[0].url).toBe('https://paddle.test/subscriptions/sub_1');
    expect(paddleCalls[0].headers.Authorization).toBe('Bearer pdl_key');
  });

  it('502s with Paddle error detail on upstream failure', async () => {
    paddleResponses.push({ status: 404, body: { error: { code: 'subscription_not_found', detail: 'gone' } } });
    const res = await worker.fetch(req('/subscription'), envWith({ 'ent:g-123': ENT_RECORD }));
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toBe('gone');
  });
});

describe('POST /subscription/cancel', () => {
  it('schedules cancellation at next billing period', async () => {
    const canceled = { ...PADDLE_SUB, scheduled_change: { action: 'cancel', effective_at: '2026-08-01T00:00:00Z' } };
    paddleResponses.push({ status: 200, body: { data: canceled } });
    const res = await worker.fetch(req('/subscription/cancel', { method: 'POST' }), envWith({ 'ent:g-123': ENT_RECORD }));
    expect(res.status).toBe(200);
    expect(paddleCalls[0]).toMatchObject({
      url: 'https://paddle.test/subscriptions/sub_1/cancel',
      method: 'POST',
      body: { effective_from: 'next_billing_period' },
    });
    const body = await res.json();
    expect(body.status).toBe('active');
    expect(body.scheduled_change).toEqual({ action: 'cancel', effective_at: '2026-08-01T00:00:00Z' });
  });
});

describe('POST /subscription/resume', () => {
  it('removes a scheduled cancellation', async () => {
    const scheduled = { ...PADDLE_SUB, scheduled_change: { action: 'cancel', effective_at: '2026-08-01T00:00:00Z' } };
    paddleResponses.push({ status: 200, body: { data: scheduled } }); // live GET
    paddleResponses.push({ status: 200, body: { data: PADDLE_SUB } }); // PATCH result
    const res = await worker.fetch(req('/subscription/resume', { method: 'POST' }), envWith({ 'ent:g-123': ENT_RECORD }));
    expect(res.status).toBe(200);
    expect(paddleCalls[1]).toMatchObject({
      url: 'https://paddle.test/subscriptions/sub_1',
      method: 'PATCH',
      body: { scheduled_change: null },
    });
    expect((await res.json()).scheduled_change).toBeNull();
  });

  it('409s when no cancellation is scheduled', async () => {
    const res = await worker.fetch(req('/subscription/resume', { method: 'POST' }), envWith({ 'ent:g-123': ENT_RECORD }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('no_scheduled_cancel');
    expect(paddleCalls).toHaveLength(1); // only the live GET, no PATCH
  });
});

describe('POST /subscription/change-plan', () => {
  it('400s on an invalid plan', async () => {
    const res = await worker.fetch(
      req('/subscription/change-plan', { method: 'POST', body: { plan: 'weekly' } }),
      envWith({ 'ent:g-123': ENT_RECORD })
    );
    expect(res.status).toBe(400);
  });

  it('409s when already on the target plan (from live state)', async () => {
    const res = await worker.fetch(
      req('/subscription/change-plan', { method: 'POST', body: { plan: 'monthly' } }),
      envWith({ 'ent:g-123': ENT_RECORD })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already_on_plan');
  });

  it('switches monthly→annual with prorated_immediately', async () => {
    paddleResponses.push({ status: 200, body: { data: PADDLE_SUB } }); // live GET (monthly)
    const updated = { ...PADDLE_SUB, items: [{ price: { id: 'pri_a' } }] };
    paddleResponses.push({ status: 200, body: { data: updated } });
    const res = await worker.fetch(
      req('/subscription/change-plan', { method: 'POST', body: { plan: 'annual' } }),
      envWith({ 'ent:g-123': ENT_RECORD })
    );
    expect(res.status).toBe(200);
    expect(paddleCalls[1]).toMatchObject({
      url: 'https://paddle.test/subscriptions/sub_1',
      method: 'PATCH',
      body: { items: [{ price_id: 'pri_a', quantity: 1 }], proration_billing_mode: 'prorated_immediately' },
    });
    expect((await res.json()).plan).toBe('annual');
  });

  it('switches annual→monthly with prorated_next_billing_period', async () => {
    const annualSub = { ...PADDLE_SUB, items: [{ price: { id: 'pri_a' } }] };
    paddleResponses.push({ status: 200, body: { data: annualSub } });
    paddleResponses.push({ status: 200, body: { data: PADDLE_SUB } });
    const res = await worker.fetch(
      req('/subscription/change-plan', { method: 'POST', body: { plan: 'monthly' } }),
      envWith({ 'ent:g-123': ENT_RECORD })
    );
    expect(res.status).toBe(200);
    expect(paddleCalls[1].body.proration_billing_mode).toBe('prorated_next_billing_period');
    expect(paddleCalls[1].body.items).toEqual([{ price_id: 'pri_m', quantity: 1 }]);
  });

  it('trialing subscription switches with do_not_bill (both directions)', async () => {
    const trialSub = { ...PADDLE_SUB, status: 'trialing' };
    paddleResponses.push({ status: 200, body: { data: trialSub } }); // live GET (monthly, trialing)
    paddleResponses.push({ status: 200, body: { data: { ...trialSub, items: [{ price: { id: 'pri_a' } }] } } });
    const res = await worker.fetch(
      req('/subscription/change-plan', { method: 'POST', body: { plan: 'annual' } }),
      envWith({ 'ent:g-123': ENT_RECORD })
    );
    expect(res.status).toBe(200);
    expect(paddleCalls[1].body.proration_billing_mode).toBe('do_not_bill');
  });

  it('preview: true hits the preview endpoint and returns a preview DTO', async () => {
    paddleResponses.push({ status: 200, body: { data: PADDLE_SUB } }); // live GET
    paddleResponses.push({
      status: 200,
      body: {
        data: {
          update_summary: { result: { action: 'charge', amount: '4200', currency_code: 'USD' } },
          recurring_transaction_details: { totals: { total: '4900', currency_code: 'USD' } },
          next_billed_at: '2026-07-16T00:00:00Z',
        },
      },
    });
    const res = await worker.fetch(
      req('/subscription/change-plan', { method: 'POST', body: { plan: 'annual', preview: true } }),
      envWith({ 'ent:g-123': ENT_RECORD })
    );
    expect(res.status).toBe(200);
    expect(paddleCalls[1]).toMatchObject({ url: 'https://paddle.test/subscriptions/sub_1/preview', method: 'PATCH' });
    expect(await res.json()).toEqual({
      immediate: { action: 'charge', amount: '4200', currency: 'USD' },
      recurring: { amount: '4900', currency: 'USD' },
      next_billed_at: '2026-07-16T00:00:00Z',
    });
  });

  it('passes Paddle failures through as 502 without committing', async () => {
    paddleResponses.push({ status: 200, body: { data: PADDLE_SUB } });
    paddleResponses.push({ status: 400, body: { error: { code: 'proration_error', detail: 'card declined' } } });
    const res = await worker.fetch(
      req('/subscription/change-plan', { method: 'POST', body: { plan: 'annual' } }),
      envWith({ 'ent:g-123': ENT_RECORD })
    );
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toBe('card declined');
  });
});

describe('helpers', () => {
  it('prorationModeFor charges upgrades now and defers downgrades', () => {
    expect(prorationModeFor('annual', 'active')).toBe('prorated_immediately');
    expect(prorationModeFor('monthly', 'active')).toBe('prorated_next_billing_period');
  });

  it('prorationModeFor uses do_not_bill during trial (Paddle requires it for cycle changes)', () => {
    expect(prorationModeFor('annual', 'trialing')).toBe('do_not_bill');
    expect(prorationModeFor('monthly', 'trialing')).toBe('do_not_bill');
  });

  it('toSubscriptionDto tolerates missing optional fields', () => {
    const dto = toSubscriptionDto({ status: 'active', items: [] }, { monthly: 'pri_m', annual: 'pri_a' });
    expect(dto).toEqual({
      plan: null, status: 'active', next_billed_at: null, current_period_end: null,
      scheduled_change: null, update_payment_method_url: null,
    });
  });

  it('toPreviewDto tolerates a preview with no immediate charge', () => {
    expect(toPreviewDto({})).toEqual({ immediate: null, recurring: null, next_billed_at: null });
  });
});
