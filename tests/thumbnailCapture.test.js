// tests/thumbnailCapture.test.js
const { createThumbnailCapture } = require('../chrome/thumbnail-capture.js');

const listenerSet = () => ({ addListener: jest.fn(), removeListener: jest.fn() });

function makeBrowser({ granted = true } = {}) {
    const sessionStore = {};
    return {
        _sessionStore: sessionStore,
        permissions: {
            contains: jest.fn().mockResolvedValue(granted),
            onAdded: listenerSet(),
            onRemoved: listenerSet(),
        },
        tabs: {
            onActivated: listenerSet(),
            onUpdated: listenerSet(),
            onRemoved: listenerSet(),
            query: jest.fn().mockResolvedValue([{ id: 7, active: true }]),
            captureVisibleTab: jest.fn().mockResolvedValue('data:image/jpeg;base64,RAW'),
        },
        windows: {
            onFocusChanged: listenerSet(),
            getAll: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
        },
        storage: {
            session: {
                get: jest.fn(async (key) => (key in sessionStore ? { [key]: sessionStore[key] } : {})),
                set: jest.fn(async (items) => Object.assign(sessionStore, items)),
                remove: jest.fn(async (keys) => {
                    (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete sessionStore[k]);
                }),
            },
        },
    };
}

const identityDownscale = jest.fn(async (dataUrl) => `scaled:${dataUrl}`);

describe('createThumbnailCapture', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    test('init() attaches all capture listeners synchronously (MV3 wake requirement)', () => {
        const browser = makeBrowser();
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.init();
        // No awaits before these asserts — attachment must be synchronous.
        expect(browser.tabs.onActivated.addListener).toHaveBeenCalled();
        expect(browser.tabs.onUpdated.addListener).toHaveBeenCalled();
        expect(browser.windows.onFocusChanged.addListener).toHaveBeenCalled();
        expect(browser.tabs.onRemoved.addListener).toHaveBeenCalled();
        expect(browser.permissions.onRemoved.addListener).toHaveBeenCalled();
    });

    test('without the permission, capture events are no-ops (nothing captured or stored)', async () => {
        const browser = makeBrowser({ granted: false });
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.init();
        capture.scheduleCapture(1);
        await jest.advanceTimersByTimeAsync(700);
        expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
        expect(browser._sessionStore.thumb_index).toBeUndefined();
    });

    test('scheduleCapture debounces, captures the visible tab, downscales, and stores with LRU index', async () => {
        const browser = makeBrowser();
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.scheduleCapture(1);
        capture.scheduleCapture(1); // coalesced
        await jest.advanceTimersByTimeAsync(700);
        expect(browser.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
        expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(1, { format: 'jpeg', quality: 70 });
        expect(browser._sessionStore.thumb_7.dataUrl).toBe('scaled:data:image/jpeg;base64,RAW');
        expect(browser._sessionStore.thumb_index).toEqual([7]);
    });

    test('evicts the oldest thumbnail beyond the 100-entry cap', async () => {
        const browser = makeBrowser();
        // Pre-fill a full index: tab ids 1..100, id 100 is oldest (last).
        browser._sessionStore.thumb_index = Array.from({ length: 100 }, (_, i) => i + 1);
        browser._sessionStore.thumb_100 = { dataUrl: 'old', capturedAt: 0 };
        browser.tabs.query.mockResolvedValue([{ id: 999, active: true }]);
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.scheduleCapture(1);
        await jest.advanceTimersByTimeAsync(700);
        expect(browser._sessionStore.thumb_index).toHaveLength(100);
        expect(browser._sessionStore.thumb_index[0]).toBe(999);
        expect(browser._sessionStore.thumb_index).not.toContain(100);
        expect(browser._sessionStore.thumb_100).toBeUndefined();
    });

    test('capture failures (chrome:// pages, closed windows) are swallowed', async () => {
        const browser = makeBrowser();
        browser.tabs.captureVisibleTab.mockRejectedValue(new Error('Cannot access contents of the page'));
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.scheduleCapture(1);
        await expect(jest.advanceTimersByTimeAsync(700)).resolves.not.toThrow();
        expect(browser._sessionStore.thumb_index).toBeUndefined();
    });

    test('tab removal prunes its thumbnail and index entry', async () => {
        const browser = makeBrowser();
        browser._sessionStore.thumb_index = [7, 8];
        browser._sessionStore.thumb_7 = { dataUrl: 'x', capturedAt: 0 };
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.init();
        const onRemoved = browser.tabs.onRemoved.addListener.mock.calls[0][0];
        await onRemoved(7);
        expect(browser._sessionStore.thumb_index).toEqual([8]);
        expect(browser._sessionStore.thumb_7).toBeUndefined();
    });

    test('permission revocation clears the cache', async () => {
        const browser = makeBrowser();
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.init();
        browser._sessionStore.thumb_index = [7];
        browser._sessionStore.thumb_7 = { dataUrl: 'x', capturedAt: 0 };
        browser.permissions.contains.mockResolvedValue(false);
        const onPermRemoved = browser.permissions.onRemoved.addListener.mock.calls[0][0];
        await onPermRemoved();
        expect(browser._sessionStore.thumb_7).toBeUndefined();
        expect(browser._sessionStore.thumb_index).toBeUndefined();
    });

    test('captureAllWindows schedules a capture for every open window', async () => {
        const browser = makeBrowser();
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        await capture.captureAllWindows();
        await jest.advanceTimersByTimeAsync(700);
        expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(1, expect.anything());
        expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(2, expect.anything());
    });
});
