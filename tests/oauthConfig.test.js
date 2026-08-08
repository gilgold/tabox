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
});
