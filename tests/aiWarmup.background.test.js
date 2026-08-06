const { createBrowserHarness } = require('./helpers/browserHarness');

describe('aiWarmup message handler', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete globalThis.TaboxAIClient;
    });

    test('warms the model by creating then destroying a session', async () => {
        const destroy = jest.fn();
        globalThis.TaboxAIClient = { createAISession: jest.fn().mockResolvedValue({ destroy }) };
        require('../chrome/background.js');
        const res = await browser.runtime.sendMessage({ type: 'aiWarmup' });
        expect(globalThis.TaboxAIClient.createAISession).toHaveBeenCalledTimes(1);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(res).toEqual({ ok: true });
    });

    test('aiWarmup resolves ok even when the model is unavailable', async () => {
        globalThis.TaboxAIClient = { createAISession: jest.fn().mockRejectedValue(new Error('unavailable')) };
        require('../chrome/background.js');
        const res = await browser.runtime.sendMessage({ type: 'aiWarmup' });
        expect(res).toEqual({ ok: true });
    });
});
