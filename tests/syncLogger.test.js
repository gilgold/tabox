const { createBrowserHarness } = require('./helpers/browserHarness');

describe('sync log durability and safe diagnostics', () => {
    let browser, api;
    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness({ syncData: { syncFileId: 'private-file-id' } });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        api = require('../chrome/background-utils');
    });
    afterEach(() => { delete global.browser; delete global.chrome; delete global.fetch; });

    test('same-tick failure and release both survive in reverse chronological order', async () => {
        const first = api.logSyncOperation('error', 'Validation failed');
        const second = api.logSyncOperation('info', 'Released lock');
        await Promise.all([first, second]);
        expect(browser.storage.local._data.syncLogs.map(e => e.message)).toEqual(['Released lock', 'Validation failed']);
    });

    test('concurrent appends retain newest 20 in UI order', async () => {
        await Promise.all(Array.from({ length: 50 }, (_, i) => api.logSyncOperation('info', `Event ${i}`)));
        expect(browser.storage.local._data.syncLogs.map(e => e.message)).toEqual(Array.from({ length: 20 }, (_, i) => `Event ${49 - i}`));
    });

    test.each(['get', 'set'])('recovers after storage %s failure without rejected promises or stuck queue', async method => {
        browser.storage.local[method].mockRejectedValueOnce(new Error('Synthetic storage failure'));
        await expect(api.logSyncOperation('error', 'First')).resolves.toBeUndefined();
        await api.logSyncOperation('info', 'Recovered');
        expect(browser.storage.local._data.syncLogs[0].message).toBe('Recovered');
    });

    test('redacts credential-bearing URLs in messages and URL fields before storage and console', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const url = 'https://user:secret@example.invalid/path?access_token=private-token&code=private-code';
        await api.logSyncOperation('error', `Request failed: ${url}`, { url });
        const text = JSON.stringify([browser.storage.local._data.syncLogs, spy.mock.calls]);
        expect(text).not.toMatch(/secret|private-token|private-code/);
        spy.mockRestore();
    });

    test('safe rejection status survives the rolling tail', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ timestamp: 1000, tabsArray: {} }) }));
        expect(await api.syncData('synthetic')).toBe(false);
        await Promise.all(Array.from({ length: 25 }, (_, i) => api.logSyncOperation('info', `Later ${i}`)));
        expect(browser.storage.local._data.syncLogs.some(e => e.data.stage === 'remote-validation')).toBe(false);
        expect(browser.storage.local._data.lastSyncValidationFailure).toEqual({
            timestamp: expect.any(String), stage: 'remote-validation', reason: 'invalid-structure'
        });
    });

    test.each([null, [], { timestamp: 1000, tabsArray: {} },
        { timestamp: 1000, tabsArray: [{ uid: 'private-uid', name: 'private-title', tabs: [{ url: 'https://private-url.invalid' }] }], syncVersion: 'private-version-token', 'private-key': 'private-document' }
    ])('remote diagnostics expose types/presence/counts and static failure codes only: %p', async payload => {
        global.fetch = jest.fn(async url => ({ ok: true, json: async () => url.includes('fields=modifiedByMeTime') ? { modifiedByMeTime: new Date(1000).toISOString() } : payload }));
        await api.syncData('private-access-token');
        // syncData's awaited lock release must drain prior fire-and-forget logs.
        const logs = browser.storage.local._data.syncLogs;
        const raw = logs.find(e => e.message === 'Raw server response received');
        expect(raw.data).toEqual(expect.objectContaining({
            stage: 'remote-read', topLevelType: payload === null ? 'null' : Array.isArray(payload) ? 'array' : 'object',
            tabsArrayIsArray: Array.isArray(payload?.tabsArray),
            syncVersionPresent: Boolean(payload && Object.prototype.hasOwnProperty.call(payload, 'syncVersion'))
        }));
        expect(logs.some(e => e.level === 'error' && e.data.stage === 'remote-validation' && e.data.reason)).toBe(true);
        expect(JSON.stringify(logs)).not.toMatch(/private-file-id|private-access-token|private-version-token|private-title|private-url|private-key|private-document/);
    });
});
