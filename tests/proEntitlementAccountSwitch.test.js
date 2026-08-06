// Account-switch guard for the Pro entitlement cache (chrome/pro-entitlement.js):
// a cached entitlement belongs to the Google account that fetched it. After a
// sign-out + sign-in as a different user, the stale record must NOT be honored.

const STORAGE = {};
const storageLocal = {
  get: jest.fn(async (keys) => {
    const names = Array.isArray(keys) ? keys : [keys];
    return names.reduce((acc, k) => ({ ...acc, [k]: STORAGE[k] }), {});
  }),
  set: jest.fn(async (obj) => Object.assign(STORAGE, obj)),
  remove: jest.fn(async (k) => {
    const names = Array.isArray(k) ? k : [k];
    names.forEach((n) => { delete STORAGE[n]; });
  }),
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

const freshServerRecord = { entitled: true, status: 'active', plan: 'monthly', expiresAt: null, token: 'jwt' };

describe('refreshProEntitlement ownership stamp', () => {
  it('stamps the record with the signed-in user permissionId as ownerId', async () => {
    STORAGE.googleUser = { permissionId: 'user-A', emailAddress: 'a@b.c' };
    STORAGE.googleRefreshToken = 'rt';
    global.fetch.mockResolvedValue({ ok: true, json: async () => freshServerRecord });
    const { refreshProEntitlement } = load();
    const record = await refreshProEntitlement();
    expect(record.ownerId).toBe('user-A');
    expect(STORAGE.premiumEntitlement.ownerId).toBe('user-A');
  });
});

describe('getProEntitlementForUser', () => {
  it('returns null when there is no cached record (no network)', async () => {
    const { getProEntitlementForUser } = load();
    expect(await getProEntitlementForUser()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns the cached record when it belongs to the current user (no network)', async () => {
    STORAGE.googleUser = { permissionId: 'user-A' };
    STORAGE.googleRefreshToken = 'rt';
    const cached = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString(), ownerId: 'user-A' };
    STORAGE.premiumEntitlement = cached;
    const { getProEntitlementForUser } = load();
    expect(await getProEntitlementForUser()).toEqual(cached);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still honors a legacy record without an ownerId stamp (no network)', async () => {
    STORAGE.googleUser = { permissionId: 'user-A' };
    STORAGE.googleRefreshToken = 'rt';
    const cached = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };
    STORAGE.premiumEntitlement = cached;
    const { getProEntitlementForUser } = load();
    expect(await getProEntitlementForUser()).toEqual(cached);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('drops a record cached by a DIFFERENT account and refreshes for the current user', async () => {
    STORAGE.googleUser = { permissionId: 'user-B' };
    STORAGE.googleRefreshToken = 'rt';
    STORAGE.premiumEntitlement = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString(), ownerId: 'user-A' };
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...freshServerRecord, entitled: false, status: 'none', plan: null, token: null }) });
    const { getProEntitlementForUser } = load();
    const result = await getProEntitlementForUser();
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/entitlement', { headers: { Authorization: 'Bearer g-token' } });
    expect(result.entitled).toBe(false);
    expect(result.ownerId).toBe('user-B');
    expect(STORAGE.premiumEntitlement.ownerId).toBe('user-B');
  });

  it('returns null on account mismatch when the refresh cannot complete (authError), stale record stays gone', async () => {
    STORAGE.googleUser = { permissionId: 'user-B' };
    // Signed in but no refresh token -> refreshProEntitlement returns { authError: true }
    STORAGE.premiumEntitlement = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString(), ownerId: 'user-A' };
    const { getProEntitlementForUser } = load();
    expect(await getProEntitlementForUser()).toBeNull();
    expect(STORAGE.premiumEntitlement).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('drops a lingering record when fully signed out (no googleUser, no refresh token)', async () => {
    STORAGE.premiumEntitlement = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString(), ownerId: 'user-A' };
    const { getProEntitlementForUser } = load();
    expect(await getProEntitlementForUser()).toBeNull();
    expect(STORAGE.premiumEntitlement).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps the cache during the transient !googleUser + refreshToken recovery state', async () => {
    // background.js sync recovery can briefly have a refresh token but no
    // googleUser; that is NOT a sign-out and must not nuke the cache.
    STORAGE.googleRefreshToken = 'rt';
    const cached = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString(), ownerId: 'user-A' };
    STORAGE.premiumEntitlement = cached;
    const { getProEntitlementForUser } = load();
    expect(await getProEntitlementForUser()).toEqual(cached);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
