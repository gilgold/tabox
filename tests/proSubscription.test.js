// Background-side subscription management (chrome/pro-entitlement.js):
// proSubscriptionRequest + handleProSubscriptionMessage.

const STORAGE = {};
const storageLocal = {
  get: jest.fn(async (keys) => {
    const names = Array.isArray(keys) ? keys : [keys];
    return names.reduce((acc, k) => ({ ...acc, [k]: STORAGE[k] }), {});
  }),
  set: jest.fn(async (obj) => Object.assign(STORAGE, obj)),
  remove: jest.fn(async (k) => { delete STORAGE[k]; }),
};

beforeEach(() => {
  for (const k of Object.keys(STORAGE)) delete STORAGE[k];
  global.browser = {
    storage: { local: storageLocal },
    tabs: { create: jest.fn(async () => ({})) },
    alarms: { create: jest.fn(async () => {}), clear: jest.fn(async () => {}), getAll: jest.fn(async () => []) },
  };
  global.getAuthToken = jest.fn(async () => 'g-token');
  global.PRO_API_BASE = 'https://api.test';
  global.PRO_CHECKOUT_URL = 'https://tabox.co/pro';
  global.fetch = jest.fn();
  jest.resetModules();
});

const load = () => require('../chrome/pro-entitlement.js');

const SUB_DTO = {
  plan: 'monthly', status: 'active', next_billed_at: '2026-08-01T00:00:00Z',
  current_period_end: '2026-08-01T00:00:00Z', scheduled_change: null,
  update_payment_method_url: 'https://paddle.test/pay',
};

describe('proSubscriptionRequest', () => {
  it('returns not_signed_in without a token (never calls the network)', async () => {
    global.getAuthToken = jest.fn(async () => null);
    const { proSubscriptionRequest } = load();
    expect(await proSubscriptionRequest('/subscription')).toEqual({ ok: false, error: 'not_signed_in' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('GETs with the bearer token and returns the payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => SUB_DTO });
    const { proSubscriptionRequest } = load();
    const result = await proSubscriptionRequest('/subscription');
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/subscription', {
      method: 'GET',
      headers: { Authorization: 'Bearer g-token' },
      body: undefined,
    });
    expect(result).toEqual({ ok: true, data: SUB_DTO });
  });

  it('surfaces server errors with their error code and detail', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'paddle_error', detail: 'card declined' }) });
    const { proSubscriptionRequest } = load();
    const result = await proSubscriptionRequest('/subscription/cancel', { method: 'POST' });
    expect(result).toEqual({ ok: false, error: 'paddle_error', detail: 'card declined' });
  });

  it('returns network_error on fetch failure instead of throwing', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    const { proSubscriptionRequest } = load();
    expect(await proSubscriptionRequest('/subscription')).toEqual({ ok: false, error: 'network_error' });
  });
});

describe('handleProSubscriptionMessage', () => {
  it('proGetSubscription proxies GET /subscription', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => SUB_DTO });
    const { handleProSubscriptionMessage } = load();
    const result = await handleProSubscriptionMessage({ type: 'proGetSubscription' });
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/subscription', expect.objectContaining({ method: 'GET' }));
  });

  it('proCancelSubscription POSTs and refreshes the cached entitlement', async () => {
    STORAGE.googleRefreshToken = 'rt';
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...SUB_DTO, scheduled_change: { action: 'cancel', effective_at: '2026-08-01T00:00:00Z' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entitled: true, status: 'active', plan: 'monthly' }) });
    const { handleProSubscriptionMessage } = load();
    const result = await handleProSubscriptionMessage({ type: 'proCancelSubscription' });
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenNthCalledWith(1, 'https://api.test/subscription/cancel', expect.objectContaining({ method: 'POST' }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, 'https://api.test/entitlement', expect.anything());
    expect(STORAGE.premiumEntitlement).toBeDefined();
  });

  it('proChangePlan sends plan and preview flag, and does NOT refresh on preview', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ immediate: null, recurring: null, next_billed_at: null }) });
    const { handleProSubscriptionMessage } = load();
    const result = await handleProSubscriptionMessage({ type: 'proChangePlan', plan: 'annual', preview: true });
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.test/subscription/change-plan');
    expect(JSON.parse(opts.body)).toEqual({ plan: 'annual', preview: true });
  });

  it('proChangePlan commit refreshes the cached entitlement', async () => {
    STORAGE.googleRefreshToken = 'rt';
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...SUB_DTO, plan: 'annual' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entitled: true, status: 'active', plan: 'annual' }) });
    const { handleProSubscriptionMessage } = load();
    const result = await handleProSubscriptionMessage({ type: 'proChangePlan', plan: 'annual' });
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('failed mutations do not refresh the entitlement', async () => {
    STORAGE.googleRefreshToken = 'rt';
    global.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'no_scheduled_cancel' }) });
    const { handleProSubscriptionMessage } = load();
    const result = await handleProSubscriptionMessage({ type: 'proResumeSubscription' });
    expect(result).toEqual({ ok: false, error: 'no_scheduled_cancel', detail: undefined });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for unrelated message types', async () => {
    const { handleProSubscriptionMessage } = load();
    expect(await handleProSubscriptionMessage({ type: 'somethingElse' })).toBeUndefined();
  });
});
