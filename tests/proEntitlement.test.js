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

describe('refreshProEntitlement', () => {
  it('returns null without a refresh token (never calls the network)', async () => {
    const { refreshProEntitlement } = load();
    expect(await refreshProEntitlement()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches, stamps refreshedAt, and stores the record', async () => {
    STORAGE.googleRefreshToken = 'rt';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ entitled: true, status: 'active', plan: 'monthly', expiresAt: null, token: 'jwt' }) });
    const { refreshProEntitlement } = load();
    const record = await refreshProEntitlement();
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/entitlement', { headers: { Authorization: 'Bearer g-token' } });
    expect(record.entitled).toBe(true);
    expect(typeof record.refreshedAt).toBe('string');
    expect(STORAGE.premiumEntitlement).toEqual(record);
  });

  it('returns an authError record when signed in but the refresh token is missing (no network, cache untouched)', async () => {
    STORAGE.googleUser = { permissionId: 'g-123', emailAddress: 'a@b.c' };
    const cached = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };
    STORAGE.premiumEntitlement = cached;
    const { refreshProEntitlement } = load();
    expect(await refreshProEntitlement()).toEqual({ authError: true });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(STORAGE.premiumEntitlement).toEqual(cached);
  });

  it('returns an authError record when signed in and getAuthToken fails (revoked token)', async () => {
    STORAGE.googleUser = { permissionId: 'g-123', emailAddress: 'a@b.c' };
    STORAGE.googleRefreshToken = 'rt';
    global.getAuthToken = jest.fn(async () => { throw new Error('invalid_grant'); });
    const { refreshProEntitlement } = load();
    expect(await refreshProEntitlement()).toEqual({ authError: true });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(STORAGE.premiumEntitlement).toBeUndefined();
  });

  it('returns null (not authError) when fully signed out with no refresh token', async () => {
    const { refreshProEntitlement } = load();
    expect(await refreshProEntitlement()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null and stores nothing on HTTP error or network failure', async () => {
    STORAGE.googleRefreshToken = 'rt';
    global.fetch.mockResolvedValue({ ok: false });
    const { refreshProEntitlement } = load();
    expect(await refreshProEntitlement()).toBeNull();
    global.fetch.mockRejectedValue(new Error('offline'));
    expect(await refreshProEntitlement()).toBeNull();
    expect(STORAGE.premiumEntitlement).toBeUndefined();
  });
});

describe('openProCheckout', () => {
  it('returns false when not signed in', async () => {
    const { openProCheckout } = load();
    expect(await openProCheckout()).toBe(false);
    expect(global.browser.tabs.create).not.toHaveBeenCalled();
  });

  it('opens checkout tab with uid+email, sets pending flag, starts poll alarm', async () => {
    STORAGE.googleUser = { permissionId: 'g-123', emailAddress: 'a@b.c' };
    const { openProCheckout } = load();
    expect(await openProCheckout()).toBe(true);
    expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://tabox.co/pro?uid=g-123&email=a%40b.c' });
    expect(STORAGE.proCheckoutPendingUntil).toBeGreaterThan(Date.now());
    expect(global.browser.alarms.create).toHaveBeenCalledWith('pro-checkout-poll', { periodInMinutes: 1 });
  });
});

describe('handleProAlarm', () => {
  it('clears the poll alarm once entitled', async () => {
    STORAGE.googleRefreshToken = 'rt';
    STORAGE.proCheckoutPendingUntil = Date.now() + 60000;
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ entitled: true, status: 'trialing', plan: 'monthly', expiresAt: null, token: 'jwt' }) });
    const { handleProAlarm } = load();
    expect(await handleProAlarm('pro-checkout-poll')).toBe(true);
    expect(global.browser.alarms.clear).toHaveBeenCalledWith('pro-checkout-poll');
    expect(STORAGE.proCheckoutPendingUntil).toBeUndefined();
  });

  it('returns false for unrelated alarms', async () => {
    const { handleProAlarm } = load();
    expect(await handleProAlarm('background-sync')).toBe(false);
  });

  it('skips the Worker for pro-entitlement-refresh when there is no cached entitlement and no pending checkout', async () => {
    STORAGE.googleRefreshToken = 'rt';
    const { handleProAlarm, PRO_ENTITLEMENT_ALARM } = load();
    expect(await handleProAlarm(PRO_ENTITLEMENT_ALARM)).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes on pro-entitlement-refresh when a cached entitlement record exists', async () => {
    STORAGE.googleRefreshToken = 'rt';
    STORAGE.premiumEntitlement = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ entitled: true, status: 'active', plan: 'monthly', expiresAt: null, token: 'jwt' }) });
    const { handleProAlarm, PRO_ENTITLEMENT_ALARM } = load();
    expect(await handleProAlarm(PRO_ENTITLEMENT_ALARM)).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });
});
