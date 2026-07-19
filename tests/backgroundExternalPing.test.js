// The join page's onMessageExternal contract: a cheap ping that answers
// immediately (install detection must NOT wait on the full redeem, which does
// network + storage work and can legitimately take seconds), plus routing of
// the real redeem message and a closed reply for anything else.
const { createBrowserHarness } = require('./helpers/browserHarness');

describe('background onMessageExternal (share links)', () => {
    let browser;

    beforeEach(() => {
        jest.resetModules();
        browser = createBrowserHarness({});
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.handleShareLinkRedeem = jest.fn(async () => ({ ok: true, status: 'joined', name: 'Team' }));
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.handleShareLinkRedeem;
    });

    test('taboxShareLinkPing replies pong immediately without touching the redeem path', async () => {
        require('../chrome/background.js');
        const [reply] = await browser.runtime.onMessageExternal.trigger({ type: 'taboxShareLinkPing' });
        expect(reply).toEqual({ ok: true, status: 'pong' });
        expect(global.handleShareLinkRedeem).not.toHaveBeenCalled();
    });

    test('taboxShareLink routes to handleShareLinkRedeem with the token', async () => {
        require('../chrome/background.js');
        const [reply] = await browser.runtime.onMessageExternal.trigger({ type: 'taboxShareLink', token: 'tok-1' });
        expect(global.handleShareLinkRedeem).toHaveBeenCalledWith('tok-1');
        expect(reply).toEqual({ ok: true, status: 'joined', name: 'Team' });
    });

    test('unknown external messages get a closed error reply', async () => {
        require('../chrome/background.js');
        const [reply] = await browser.runtime.onMessageExternal.trigger({ type: 'somethingElse' });
        expect(reply).toEqual({ ok: false, status: 'error', error: 'unknown_message' });
    });
});
