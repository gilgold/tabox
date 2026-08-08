const { createBrowserHarness } = require('./helpers/browserHarness');

// Regression test for the Firefox-port bug found by the real-Firefox journey
// harness (.superpowers/sdd/task-8-firefox-harness-report.md): isNewWindow()
// in chrome/background.js only recognized Chrome's `chrome://newtab/` shape
// (substring match on '://newtab'), so Firefox's default new-window starter
// tab (`about:home` / `about:newtab` / `about:blank`, or `about:privatebrowsing`
// for a fresh private window) was never treated as a "new window" starter tab.
// openTabs() then never reused that starter tab, leaving an extra blank tab
// behind after every "restore into new window" on Firefox.
describe('isNewWindow', () => {
    let isNewWindow;

    beforeEach(() => {
        jest.resetModules();

        global.browser = createBrowserHarness();
        global.chrome = { runtime: global.browser.runtime };
        global.importScripts = jest.fn();

        ({ isNewWindow } = require('../chrome/background.js'));
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    const windowWith = (tabs) => ({ tabs });

    test('Chrome new-tab URL (chrome://newtab/) is a new window', () => {
        expect(isNewWindow(windowWith([{ url: 'chrome://newtab/' }]))).toBe(true);
    });

    test.each(['about:home', 'about:newtab', 'about:blank', 'about:privatebrowsing'])(
        'Firefox new-tab URL %s is a new window',
        (url) => {
            expect(isNewWindow(windowWith([{ url }]))).toBe(true);
        }
    );

    test('a tab with no url at all is a new window', () => {
        expect(isNewWindow(windowWith([{ url: undefined }]))).toBe(true);
    });

    test('a regular page is not a new window', () => {
        expect(isNewWindow(windowWith([{ url: 'https://example.com' }]))).toBe(false);
    });

    test('about:config is not a new window (no substring-matching "about:")', () => {
        expect(isNewWindow(windowWith([{ url: 'about:config' }]))).toBe(false);
    });

    test('a window with more than one tab is not a new window', () => {
        expect(isNewWindow(windowWith([{ url: 'about:blank' }, { url: 'about:blank' }]))).toBe(false);
    });
});
