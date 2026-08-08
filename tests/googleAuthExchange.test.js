const { createBrowserHarness } = require('./helpers/browserHarness');
const { PRO_API_BASE } = require('../chrome/pro-config');

describe('worker-proxied Google OAuth exchange', () => {
    let browser;
    let backgroundUtils;

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.fetch = jest.fn();
        backgroundUtils = require('../chrome/background-utils.js');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
        delete global.fetch;
    });

    describe('getTokens', () => {
        test('exchanges the auth code via the worker using the current dynamic redirect (Chrome/Edge chromiumapp.org path)', async () => {
            browser.identity.getRedirectURL.mockReturnValue('https://oidjngowedjndwewewd.chromiumapp.org/');
            global.fetch.mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1' }),
            });

            const token = await backgroundUtils.getTokens('auth-code');

            expect(token).toBe('at-1');
            expect(browser.storage.local._data.googleToken).toBe('at-1');
            expect(browser.storage.local._data.googleRefreshToken).toBe('rt-1');
            const [url, options] = global.fetch.mock.calls[0];
            expect(url).toBe(`${PRO_API_BASE}/auth/token`);
            expect(JSON.parse(options.body)).toEqual({
                grant_type: 'authorization_code',
                code: 'auth-code',
                redirect_uri: browser.identity.getRedirectURL(),
            });
        });

        test('exchanges via the Worker callback redirect on non-chromiumapp (Firefox-style) redirects', async () => {
            // The harness default (a plain https URL, not *.chromiumapp.org)
            // stands in for Firefox's per-profile allizom redirect here —
            // getTokens must send the fixed Worker callback as redirect_uri,
            // matching what createAuthEndpoint used for the auth request.
            global.fetch.mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1' }),
            });

            await backgroundUtils.getTokens('auth-code');

            const [, options] = global.fetch.mock.calls[0];
            expect(JSON.parse(options.body)).toEqual({
                grant_type: 'authorization_code',
                code: 'auth-code',
                redirect_uri: `${PRO_API_BASE}/auth/callback`,
            });
        });

        test('returns false when the worker rejects the code', async () => {
            global.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
            expect(await backgroundUtils.getTokens('bad-code')).toBe(false);
            expect(browser.storage.local._data.googleToken).toBeUndefined();
        });
    });

    describe('getNewAccessToken', () => {
        test('refreshes via the worker and stores the new access token', async () => {
            browser.storage.local._data.googleRefreshToken = 'rt-1';
            global.fetch.mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ access_token: 'at-2', expires_in: 3600 }),
            });

            const token = await backgroundUtils.getNewAccessToken();

            expect(token).toBe('at-2');
            expect(browser.storage.local._data.googleToken).toBe('at-2');
            const [url, options] = global.fetch.mock.calls[0];
            expect(url).toBe(`${PRO_API_BASE}/auth/token`);
            expect(JSON.parse(options.body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
        });

        test('invalid_grant clears tokens and records syncAuthError', async () => {
            browser.storage.local._data.googleRefreshToken = 'rt-expired';
            browser.storage.local._data.googleToken = 'stale';
            global.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });

            expect(await backgroundUtils.getNewAccessToken()).toBe(false);
            expect(browser.storage.local._data.googleToken).toBeUndefined();
            expect(browser.storage.local._data.googleRefreshToken).toBeUndefined();
            expect(browser.storage.local._data.syncAuthError.type).toBe('invalid_grant');
        });

        test('never fetches api-keys.json', async () => {
            browser.storage.local._data.googleRefreshToken = 'rt-1';
            global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'at' }) });
            await backgroundUtils.getNewAccessToken();
            const urls = global.fetch.mock.calls.map(([u]) => String(u));
            expect(urls.some((u) => u.includes('api-keys.json'))).toBe(false);
        });
    });

    describe('getGoogleUser', () => {
        test('fetches Drive about with only the Bearer token (no api key, no api-keys.json)', async () => {
            global.fetch.mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ user: { permissionId: 'g-1', emailAddress: 'a@b.c' } }),
            });

            const user = await backgroundUtils.getGoogleUser('tok');

            expect(user).toEqual({ permissionId: 'g-1', emailAddress: 'a@b.c' });
            const urls = global.fetch.mock.calls.map(([u]) => String(u));
            expect(urls.some((u) => u.includes('api-keys.json'))).toBe(false);
            expect(urls[0]).toContain('https://www.googleapis.com/drive/v3/about');
            expect(urls[0]).not.toContain('key=');
        });
    });
});
