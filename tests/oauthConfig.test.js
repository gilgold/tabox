const baseManifest = require('../chrome/manifest.json');
const proConfig = require('../chrome/pro-config.js');

describe('OAuth config', () => {
    test('pro-config exports OAuth client id and scopes', () => {
        expect(proConfig.OAUTH_CLIENT_ID).toBe(baseManifest.oauth2.client_id);
        expect(proConfig.OAUTH_SCOPES).toEqual(baseManifest.oauth2.scopes);
    });

    test('createAuthEndpoint builds the Google auth URL from pro-config, not the manifest', () => {
        jest.resetModules();
        globalThis.OAUTH_CLIENT_ID = proConfig.OAUTH_CLIENT_ID;
        globalThis.OAUTH_SCOPES = proConfig.OAUTH_SCOPES;
        globalThis.browser = {
            identity: {
                getRedirectURL: jest.fn(() => 'https://oidjngowedjndwewewd.chromiumapp.org/')
            }
        };
        const { createAuthEndpoint } = require('../chrome/background-utils.js');
        const url = new URL(createAuthEndpoint());
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(url.searchParams.get('client_id')).toBe(proConfig.OAUTH_CLIENT_ID);
        expect(url.searchParams.get('scope')).toBe('openid ' + proConfig.OAUTH_SCOPES.join(' '));
        expect(url.searchParams.get('response_type')).toBe('code');
        delete globalThis.browser;
    });

    describe('dual-redirect OAuth flow (Firefox port)', () => {
        const CHROMIUMAPP_REDIRECT = 'https://oidjngowedjndwewewd.chromiumapp.org/';
        const ALLIZOM_REDIRECT = 'https://ab12cd34-ef56-7890-ab12-cd34ef567890.extensions.allizom.org/';

        const setupGlobals = (redirectUrl) => {
            jest.resetModules();
            globalThis.OAUTH_CLIENT_ID = proConfig.OAUTH_CLIENT_ID;
            globalThis.OAUTH_SCOPES = proConfig.OAUTH_SCOPES;
            globalThis.browser = {
                identity: {
                    getRedirectURL: jest.fn(() => redirectUrl)
                }
            };
            return require('../chrome/background-utils.js');
        };

        afterEach(() => {
            delete globalThis.browser;
            delete globalThis.OAUTH_CLIENT_ID;
            delete globalThis.OAUTH_SCOPES;
        });

        test('getAuthRedirectConfig: *.chromiumapp.org redirect is treated as the Chrome/Edge path (no Worker)', () => {
            const { getAuthRedirectConfig } = setupGlobals(CHROMIUMAPP_REDIRECT);
            expect(getAuthRedirectConfig()).toEqual({
                authRedirect: CHROMIUMAPP_REDIRECT,
                exchangeRedirect: CHROMIUMAPP_REDIRECT,
                viaWorker: false,
            });
        });

        test('getAuthRedirectConfig: any other redirect (e.g. Firefox allizom) routes through the Worker callback', () => {
            const { getAuthRedirectConfig } = setupGlobals(ALLIZOM_REDIRECT);
            expect(getAuthRedirectConfig()).toEqual({
                authRedirect: `${proConfig.PRO_API_BASE}/auth/callback`,
                exchangeRedirect: `${proConfig.PRO_API_BASE}/auth/callback`,
                viaWorker: true,
                target: ALLIZOM_REDIRECT,
            });
        });

        test('createAuthEndpoint is byte-identical on the chromiumapp.org path regardless of nonce (pins current Chrome/Edge behavior)', () => {
            const { createAuthEndpoint } = setupGlobals(CHROMIUMAPP_REDIRECT);
            const expectedParams = new URLSearchParams({
                client_id: proConfig.OAUTH_CLIENT_ID,
                response_type: 'code',
                access_type: 'offline',
                redirect_uri: CHROMIUMAPP_REDIRECT,
                prompt: 'consent',
                scope: 'openid ' + proConfig.OAUTH_SCOPES.join(' '),
            });
            const expected = `https://accounts.google.com/o/oauth2/v2/auth?${expectedParams.toString()}`;

            expect(createAuthEndpoint('some-nonce')).toBe(expected);
            expect(createAuthEndpoint()).toBe(expected);
        });

        test('createAuthEndpoint on a non-chromiumapp redirect uses the Worker callback as redirect_uri and packs {t, n} into state', () => {
            const { createAuthEndpoint, base64UrlDecodeJson } = setupGlobals(ALLIZOM_REDIRECT);
            const nonce = 'nonce-abc-123';

            const url = new URL(createAuthEndpoint(nonce));

            expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
            expect(url.searchParams.get('redirect_uri')).toBe(`${proConfig.PRO_API_BASE}/auth/callback`);
            expect(url.searchParams.get('client_id')).toBe(proConfig.OAUTH_CLIENT_ID);

            const rawState = url.searchParams.get('state');
            expect(rawState).toBeTruthy();
            // Must be base64url (no padding, no +/): '+' -> '-', '/' -> '_', no '='.
            expect(rawState).not.toMatch(/[+/=]/);
            expect(base64UrlDecodeJson(rawState)).toEqual({ t: ALLIZOM_REDIRECT, n: nonce });
        });

        test('base64Url encode/decode round-trips {t, n} and matches the Worker\'s expected alphabet', () => {
            const { base64UrlEncodeJson, base64UrlDecodeJson } = setupGlobals(CHROMIUMAPP_REDIRECT);
            const payload = { t: ALLIZOM_REDIRECT, n: 'abc-123-def' };

            const encoded = base64UrlEncodeJson(payload);

            expect(encoded).not.toMatch(/[+/=]/);
            expect(base64UrlDecodeJson(encoded)).toEqual(payload);
        });

        test('getTokens sends the Worker callback as redirect_uri on the non-chromiumapp (Firefox) path', async () => {
            const backgroundUtils = setupGlobals(ALLIZOM_REDIRECT);
            globalThis.browser.storage = { local: { set: jest.fn(async () => undefined) } };
            globalThis.fetch = jest.fn(async () => ({
                ok: true,
                json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1' }),
            }));

            const token = await backgroundUtils.getTokens('auth-code');

            expect(token).toBe('at-1');
            const [url, options] = globalThis.fetch.mock.calls[0];
            expect(url).toBe(`${proConfig.PRO_API_BASE}/auth/token`);
            expect(JSON.parse(options.body)).toEqual({
                grant_type: 'authorization_code',
                code: 'auth-code',
                redirect_uri: `${proConfig.PRO_API_BASE}/auth/callback`,
            });
            delete globalThis.fetch;
        });

        test('getTokens sends the dynamic redirect as redirect_uri on the chromiumapp.org path (unchanged behavior)', async () => {
            const backgroundUtils = setupGlobals(CHROMIUMAPP_REDIRECT);
            globalThis.browser.storage = { local: { set: jest.fn(async () => undefined) } };
            globalThis.fetch = jest.fn(async () => ({
                ok: true,
                json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1' }),
            }));

            await backgroundUtils.getTokens('auth-code');

            const [, options] = globalThis.fetch.mock.calls[0];
            expect(JSON.parse(options.body)).toEqual({
                grant_type: 'authorization_code',
                code: 'auth-code',
                redirect_uri: CHROMIUMAPP_REDIRECT,
            });
            delete globalThis.fetch;
        });
    });

    describe('login handler — CSRF nonce enforcement on the Worker-callback (Firefox) path', () => {
        const { createBrowserHarness } = require('./helpers/browserHarness');
        let browser;
        let backgroundUtils;

        const ALLIZOM_REDIRECT = 'https://ab12cd34-ef56-7890-ab12-cd34ef567890.extensions.allizom.org/';

        const stubLoginGlobals = () => {
            global.getOrCreateSyncFile = jest.fn(async () => 'file-123');
            global.getGoogleUser = jest.fn(async () => ({ displayName: 'Test User', email: 'a@x.com' }));
            global.loadAllCollectionsBG = jest.fn(async () => []);
            global.ensureBackgroundSyncAlarm = jest.fn(async () => {});
            global.syncData = jest.fn(async () => true);
            global.loadCollectionsIndexBG = jest.fn(async () => ({}));
            global.SYNC_SESSION_STATUS = {
                SYNCING: 'syncing', ACTIVE: 'active', ERROR: 'error', USER_INFO_ERROR: 'user_info_error'
            };
        };

        beforeEach(() => {
            jest.resetModules();
            jest.spyOn(console, 'error').mockImplementation(() => {});
            jest.spyOn(console, 'log').mockImplementation(() => {});
            browser = createBrowserHarness({ localData: {} });
            global.browser = browser;
            global.chrome = { runtime: browser.runtime };
            global.importScripts = jest.fn();
            global.getAuthToken = jest.fn(async () => 'access-token');
            global.logSyncOperation = jest.fn();
            // jsdom's crypto polyfill doesn't implement randomUUID(); the
            // login handler needs one per attempt for the CSRF nonce.
            // Replacing `global.crypto` outright is silently ignored (jsdom
            // exposes it as a getter-only accessor) — mutate the existing
            // object instead.
            crypto.randomUUID = jest.fn(() => 'test-login-nonce');
            // Real (unmocked) createAuthEndpoint/getAuthRedirectConfig/
            // base64UrlDecodeJson so the nonce round-trip under test is the
            // actual production logic, not a stand-in. OAUTH_CLIENT_ID/
            // OAUTH_SCOPES must be bare globals too (background-utils.js's
            // classic-script convention) before it's required.
            global.OAUTH_CLIENT_ID = proConfig.OAUTH_CLIENT_ID;
            global.OAUTH_SCOPES = proConfig.OAUTH_SCOPES;
            backgroundUtils = require('../chrome/background-utils.js');
            global.createAuthEndpoint = backgroundUtils.createAuthEndpoint;
            global.getAuthRedirectConfig = backgroundUtils.getAuthRedirectConfig;
            global.base64UrlDecodeJson = backgroundUtils.base64UrlDecodeJson;
            stubLoginGlobals();
        });

        afterEach(() => {
            jest.restoreAllMocks();
            delete global.browser;
            delete global.chrome;
            delete global.importScripts;
            delete global.getAuthToken;
            delete global.logSyncOperation;
            delete crypto.randomUUID;
            delete global.OAUTH_CLIENT_ID;
            delete global.OAUTH_SCOPES;
            delete global.createAuthEndpoint;
            delete global.getAuthRedirectConfig;
            delete global.base64UrlDecodeJson;
            delete global.getOrCreateSyncFile;
            delete global.getGoogleUser;
            delete global.loadAllCollectionsBG;
            delete global.ensureBackgroundSyncAlarm;
            delete global.syncData;
            delete global.loadCollectionsIndexBG;
            delete global.SYNC_SESSION_STATUS;
            delete global.getTokens;
        });

        test('rejects (no token exchange) when the state nonce returned by launchWebAuthFlow does not match', async () => {
            global.getTokens = jest.fn(async () => 'token-123');
            browser.identity = {
                getRedirectURL: jest.fn(() => ALLIZOM_REDIRECT),
                launchWebAuthFlow: jest.fn(async () => {
                    // Simulate the Worker echoing back a DIFFERENT nonce than
                    // the one the extension generated for this attempt.
                    const forgedState = backgroundUtils.base64UrlEncodeJson({ t: ALLIZOM_REDIRECT, n: 'not-the-real-nonce' });
                    return `${ALLIZOM_REDIRECT}?code=stolen-code&state=${forgedState}`;
                })
            };

            require('../chrome/background.js');
            const result = await browser.runtime.sendMessage({ type: 'login' });

            expect(result).toBe(false);
            expect(global.getTokens).not.toHaveBeenCalled();
        });

        test('rejects (no token exchange) when the Worker callback returns no state at all', async () => {
            global.getTokens = jest.fn(async () => 'token-123');
            browser.identity = {
                getRedirectURL: jest.fn(() => ALLIZOM_REDIRECT),
                launchWebAuthFlow: jest.fn(async () => `${ALLIZOM_REDIRECT}?code=stolen-code`)
            };

            require('../chrome/background.js');
            const result = await browser.runtime.sendMessage({ type: 'login' });

            expect(result).toBe(false);
            expect(global.getTokens).not.toHaveBeenCalled();
        });

        test('completes the exchange when the returned state nonce matches what was generated for this attempt', async () => {
            global.getTokens = jest.fn(async () => 'token-123');
            let capturedNonce = null;
            browser.identity = {
                getRedirectURL: jest.fn(() => ALLIZOM_REDIRECT),
                launchWebAuthFlow: jest.fn(async (opts) => {
                    const authUrl = new URL(opts.url);
                    const rawState = authUrl.searchParams.get('state');
                    capturedNonce = backgroundUtils.base64UrlDecodeJson(rawState).n;
                    // Echo the SAME state back verbatim, exactly like the Worker does.
                    return `${ALLIZOM_REDIRECT}?code=good-code&state=${rawState}`;
                })
            };

            require('../chrome/background.js');
            const result = await browser.runtime.sendMessage({ type: 'login' });

            expect(capturedNonce).toBeTruthy();
            expect(global.getTokens).toHaveBeenCalledWith('good-code');
            expect(result).toEqual({ displayName: 'Test User', email: 'a@x.com' });
        });
    });
});
