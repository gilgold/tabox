const { createBrowserHarness } = require('./helpers/browserHarness');

describe('getAuthToken network-failure handling', () => {
    let bgUtils;
    let browser;
    let fetchMock;

    const loadUtils = () => require('../chrome/background-utils.js');

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        fetchMock = jest.fn();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.fetch;
    });

    test('returns cached token when validation fails at network level and token is not expired', async () => {
        await browser.storage.local.set({
            googleToken: 'cached-token',
            tokenExpiryTime: Date.now() + 60 * 60 * 1000,
            googleRefreshToken: 'refresh-token',
        });
        fetchMock.mockImplementation(async (url) => {
            if (String(url).includes('tokeninfo')) {
                throw new TypeError('Failed to fetch');
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        bgUtils = loadUtils();

        const token = await bgUtils.getAuthToken();

        expect(token).toBe('cached-token');
        const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/token'));
        expect(refreshCalls).toHaveLength(0);
    });

    test('logs network-level validation failure at info level, not error', async () => {
        await browser.storage.local.set({
            googleToken: 'cached-token',
            tokenExpiryTime: Date.now() + 60 * 60 * 1000,
        });
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        bgUtils = loadUtils();

        await bgUtils.getAuthToken();
        // logSyncOperation persists syncLogs via a fire-and-forget promise chain
        await new Promise((resolve) => setTimeout(resolve, 0));

        const { syncLogs = [] } = await browser.storage.local.get('syncLogs');
        const entry = syncLogs.find((l) => l.message.includes('Token validation'));
        expect(entry).toBeDefined();
        expect(entry.level).toBe('info');
        expect(syncLogs.some((l) => l.level === 'error' && l.message.includes('Token validation'))).toBe(false);
    });

    test('still refreshes when validation reports the token invalid (HTTP 400)', async () => {
        await browser.storage.local.set({
            googleToken: 'stale-token',
            tokenExpiryTime: Date.now() + 60 * 60 * 1000,
            googleRefreshToken: 'refresh-token',
        });
        fetchMock.mockImplementation(async (url) => {
            if (String(url).includes('tokeninfo')) {
                return { ok: false, status: 400, json: async () => ({}) };
            }
            if (String(url).includes('/auth/token')) {
                return { ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }) };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        bgUtils = loadUtils();

        const token = await bgUtils.getAuthToken();

        expect(token).toBe('fresh-token');
    });

    test('falls back to refresh on network failure when no expiry info is stored', async () => {
        await browser.storage.local.set({
            googleToken: 'cached-token',
            googleRefreshToken: 'refresh-token',
        });
        fetchMock.mockImplementation(async (url) => {
            if (String(url).includes('tokeninfo')) {
                throw new TypeError('Failed to fetch');
            }
            if (String(url).includes('/auth/token')) {
                return { ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }) };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        bgUtils = loadUtils();

        const token = await bgUtils.getAuthToken();

        expect(token).toBe('fresh-token');
    });

    test('AI auth uses a cached non-expiring token without a validation request', async () => {
        await browser.storage.local.set({
            googleToken: 'cached-token',
            tokenExpiryTime: Date.now() + 60 * 60 * 1000,
        });
        bgUtils = loadUtils();

        const token = await bgUtils.getAuthTokenForAI();

        expect(token).toBe('cached-token');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('AI auth refreshes a token that expires within five minutes', async () => {
        await browser.storage.local.set({
            googleToken: 'expiring-token',
            tokenExpiryTime: Date.now() + 60 * 1000,
            googleRefreshToken: 'refresh-token',
        });
        fetchMock.mockImplementation(async (url) => {
            if (String(url).includes('/auth/token')) {
                return { ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }) };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        bgUtils = loadUtils();

        const token = await bgUtils.getAuthTokenForAI();

        expect(token).toBe('fresh-token');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
