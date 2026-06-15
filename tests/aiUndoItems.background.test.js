const { createBrowserHarness } = require('./helpers/browserHarness');

describe('aiUndoItems message handler', () => {
    let browser;
    let undoItems;

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        undoItems = jest.fn().mockResolvedValue(undefined);
        globalThis.TaboxAIRegistry = { getTask: jest.fn() };
        globalThis.TaboxAIEngine = {
            createEngine: jest.fn(() => ({ runTask: jest.fn(), undoLast: jest.fn(), undoItems })),
        };
        require('../chrome/background.js');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete globalThis.TaboxAIEngine;
        delete globalThis.TaboxAIRegistry;
    });

    test('routes aiUndoItems to engine.undoItems with the given uids', async () => {
        const res = await browser.runtime.sendMessage({ type: 'aiUndoItems', uids: ['c1', 'c2'] });
        expect(globalThis.TaboxAIEngine.createEngine).toHaveBeenCalled();
        expect(undoItems).toHaveBeenCalledWith({ uids: ['c1', 'c2'] });
        expect(res).toEqual({ ok: true });
    });

    test('returns ok:false when undoItems throws', async () => {
        undoItems.mockRejectedValue(new Error('boom'));
        const res = await browser.runtime.sendMessage({ type: 'aiUndoItems', uids: ['c1'] });
        expect(res).toEqual({ ok: false, error: 'boom' });
    });

    test('defaults uids to an empty array when omitted', async () => {
        await browser.runtime.sendMessage({ type: 'aiUndoItems' });
        expect(undoItems).toHaveBeenCalledWith({ uids: [] });
    });
});
