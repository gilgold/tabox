import { browser } from '../static/globals';
import {
  ensurePushSubscription,
  teardownPushSubscription,
  isPushHealthy,
  PUSH_STATE_KEY,
} from '../chrome/push-client';
import * as bgUtils from '../chrome/background-utils';

jest.mock('../chrome/background-utils', () => ({
  ...jest.requireActual('../chrome/background-utils'),
  getAuthToken: jest.fn(),
}));

// jest.setup.js's shared `browser` mock only stubs storage.local.get/set as
// static jest.fn()s (no real backing store), so install a tiny in-memory
// store here, mirroring tests/sharedFoldersClient.test.js.
function installStorageMock() {
  const store = {};
  browser.storage.local.get = jest.fn(async (keys) => {
    if (keys === undefined || keys === null) return { ...store };
    const names = Array.isArray(keys) ? keys : [keys];
    return names.reduce((acc, k) => ({ ...acc, [k]: store[k] }), {});
  });
  browser.storage.local.set = jest.fn(async (obj) => {
    Object.assign(store, obj);
  });
  browser.storage.local.remove = jest.fn(async (keys) => {
    const names = Array.isArray(keys) ? keys : [keys];
    names.forEach((k) => { delete store[k]; });
  });
  return store;
}

let store;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  store = installStorageMock();
  self.registration = {
    pushManager: {
      subscribe: jest.fn(),
      getSubscription: jest.fn(),
    },
  };
});

afterEach(() => {
  delete self.registration;
});

describe('ensurePushSubscription', () => {
  test('signed out: resolves false, no subscribe call, state untouched', async () => {
    await browser.storage.local.set({}); // no googleRefreshToken
    browser.storage.local.set.mockClear();
    const result = await ensurePushSubscription();
    expect(result).toBe(false);
    expect(self.registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(store[PUSH_STATE_KEY]).toBeUndefined();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  test('happy path: subscribes, POSTs, marks healthy, returns true', async () => {
    await browser.storage.local.set({ googleRefreshToken: 'refresh-1' });
    bgUtils.getAuthToken.mockResolvedValue('tok-1');
    self.registration.pushManager.subscribe.mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
    });
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await ensurePushSubscription();

    expect(result).toBe(true);
    expect(self.registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: false,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/push/subscribe'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
      }),
    );
    expect(store[PUSH_STATE_KEY]).toMatchObject({ endpoint: 'https://push.example/abc', healthy: true });
  });

  test('pushManager missing: resolves false, state unhealthy, no throw', async () => {
    await browser.storage.local.set({ googleRefreshToken: 'refresh-1' });
    bgUtils.getAuthToken.mockResolvedValue('tok-1');
    delete self.registration.pushManager;

    await expect(ensurePushSubscription()).resolves.toBe(false);
    expect(store[PUSH_STATE_KEY]).toMatchObject({ healthy: false });
  });

  test('subscribe() rejects: state unhealthy', async () => {
    await browser.storage.local.set({ googleRefreshToken: 'refresh-1' });
    bgUtils.getAuthToken.mockResolvedValue('tok-1');
    self.registration.pushManager.subscribe.mockRejectedValue(new Error('permission denied'));

    const result = await ensurePushSubscription();

    expect(result).toBe(false);
    expect(store[PUSH_STATE_KEY]).toMatchObject({ healthy: false });
  });

  test('register endpoint returns 500: state unhealthy', async () => {
    await browser.storage.local.set({ googleRefreshToken: 'refresh-1' });
    bgUtils.getAuthToken.mockResolvedValue('tok-1');
    self.registration.pushManager.subscribe.mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
    });
    global.fetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await ensurePushSubscription();

    expect(result).toBe(false);
    expect(store[PUSH_STATE_KEY]).toMatchObject({ healthy: false });
  });

  test('healthy state fresher than 24h short-circuits true without re-subscribing', async () => {
    await browser.storage.local.set({
      googleRefreshToken: 'refresh-1',
      [PUSH_STATE_KEY]: { endpoint: 'e', healthy: true, lastRegisteredAt: Date.now() - 1000 },
    });
    browser.storage.local.set.mockClear();

    const result = await ensurePushSubscription();

    expect(result).toBe(true);
    expect(self.registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  test('force:true re-registers even when state is fresh and healthy', async () => {
    await browser.storage.local.set({
      googleRefreshToken: 'refresh-1',
      [PUSH_STATE_KEY]: { endpoint: 'old', healthy: true, lastRegisteredAt: Date.now() - 1000 },
    });
    bgUtils.getAuthToken.mockResolvedValue('tok-1');
    self.registration.pushManager.subscribe.mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }),
    });
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await ensurePushSubscription({ force: true });

    expect(result).toBe(true);
    expect(self.registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(store[PUSH_STATE_KEY]).toMatchObject({ endpoint: 'https://push.example/new', healthy: true });
  });
});

describe('teardownPushSubscription', () => {
  test('unsubscribes existing subscription, DELETEs with endpoint, clears state', async () => {
    await browser.storage.local.set({
      [PUSH_STATE_KEY]: { endpoint: 'https://push.example/abc', healthy: true, lastRegisteredAt: Date.now() },
    });
    bgUtils.getAuthToken.mockResolvedValue('tok-1');
    const unsubscribe = jest.fn().mockResolvedValue(true);
    self.registration.pushManager.getSubscription.mockResolvedValue({
      endpoint: 'https://push.example/abc',
      unsubscribe,
    });
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    await teardownPushSubscription();

    expect(unsubscribe).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/push/subscribe'),
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ endpoint: 'https://push.example/abc' }),
      }),
    );
    expect(store[PUSH_STATE_KEY]).toBeUndefined();
  });
});

describe('isPushHealthy', () => {
  test('reflects stored state true', async () => {
    await browser.storage.local.set({ [PUSH_STATE_KEY]: { healthy: true } });
    await expect(isPushHealthy()).resolves.toBe(true);
  });

  test('reflects stored state false', async () => {
    await browser.storage.local.set({ [PUSH_STATE_KEY]: { healthy: false } });
    await expect(isPushHealthy()).resolves.toBe(false);
  });

  test('absent state resolves false', async () => {
    await expect(isPushHealthy()).resolves.toBe(false);
  });
});
