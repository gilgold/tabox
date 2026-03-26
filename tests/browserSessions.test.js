/* global browser */
import {
    getBrowserSessionCount,
    getBrowserSessionEntryKey,
    loadBrowserSessions,
    normalizeBrowserSessionEntry,
    normalizeBrowserSessionTimestamp,
    restoreBrowserSession,
    subscribeToBrowserSessions,
} from '../app/utils/browserSessions';

describe('browserSessions utilities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.sessions.getRecentlyClosed.mockResolvedValue([]);
        browser.sessions.restore.mockResolvedValue(undefined);
    });

    test('normalizes a recently closed window entry into a collection-like session group', () => {
        const entry = normalizeBrowserSessionEntry({
            lastModified: 1710000000,
            window: {
                sessionId: 'window-session-1',
                tabs: [
                    {
                        sessionId: 'tab-session-1',
                        title: 'OpenAI Docs',
                        url: 'https://openai.com/docs',
                        favIconUrl: 'https://openai.com/favicon.ico',
                        pinned: true,
                    },
                    {
                        sessionId: 'tab-session-2',
                        title: 'API Reference',
                        url: 'https://platform.openai.com/docs/api-reference',
                    },
                ],
            },
        });

        expect(entry).toMatchObject({
            timestamp: 1710000000000,
            sessionId: 'window-session-1',
            sessionEntryKey: 'window:window-session-1',
            sourceType: 'window',
            collections: [
                {
                    uid: 'browser-session-window-window-session-1',
                    name: 'Recently closed window',
                    sessionId: 'window-session-1',
                    sessionEntryKey: 'window:window-session-1',
                    sourceType: 'window',
                    chromeGroups: [],
                },
            ],
        });
        expect(entry.collections[0].tabs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                title: 'OpenAI Docs',
                url: 'https://openai.com/docs',
                favIconUrl: 'https://openai.com/favicon.ico',
                pinned: true,
            }),
            expect.objectContaining({
                title: 'API Reference',
                url: 'https://platform.openai.com/docs/api-reference',
            }),
        ]));
    });

    test('normalizes a one-tab closed window entry as a tab-shaped session while preserving the native window restore id', () => {
        const entry = normalizeBrowserSessionEntry({
            lastModified: 1710000000,
            window: {
                sessionId: 'window-session-1',
                tabs: [
                    {
                        sessionId: 'tab-session-1',
                        title: 'OpenAI Docs',
                        url: 'https://openai.com/docs',
                    },
                ],
            },
        });

        expect(entry).toEqual({
            timestamp: 1710000000000,
            sessionId: 'window-session-1',
            sessionEntryKey: 'window:window-session-1',
            sourceType: 'tab',
            collections: [
                expect.objectContaining({
                    uid: 'browser-session-window-window-session-1',
                    name: 'OpenAI Docs',
                    sessionId: 'window-session-1',
                    sessionEntryKey: 'window:window-session-1',
                    sourceType: 'tab',
                    chromeGroups: [],
                    tabs: [
                        expect.objectContaining({
                            title: 'OpenAI Docs',
                            url: 'https://openai.com/docs',
                        }),
                    ],
                }),
            ],
        });
    });

    test('normalizes a recently closed tab entry into a one-tab pseudo-window', () => {
        const entry = normalizeBrowserSessionEntry({
            lastModified: 1710000000000,
            tab: {
                sessionId: 'tab-session-1',
                title: 'Closed Tab',
                url: 'https://example.com',
            },
        });

        expect(entry.collections).toHaveLength(1);
        expect(entry.collections[0]).toEqual(expect.objectContaining({
            name: 'Closed Tab',
            sessionId: 'tab-session-1',
            sessionEntryKey: 'tab:tab-session-1',
            sourceType: 'tab',
        }));
        expect(entry.collections[0].tabs).toHaveLength(1);
    });

    test('converts second-based timestamps to milliseconds', () => {
        expect(normalizeBrowserSessionTimestamp(1710000000)).toBe(1710000000000);
        expect(normalizeBrowserSessionTimestamp(1710000000000)).toBe(1710000000000);
    });

    test('loads and normalizes browser sessions through the native API', async () => {
        browser.sessions.getRecentlyClosed.mockResolvedValue([
            {
                lastModified: 1710000000,
                tab: {
                    sessionId: 'tab-session-1',
                    title: 'Closed Tab',
                    url: 'https://example.com',
                },
            },
        ]);

        const result = await loadBrowserSessions();

        expect(browser.sessions.getRecentlyClosed).toHaveBeenCalledWith();
        expect(result).toHaveLength(1);
        expect(getBrowserSessionEntryKey(result[0])).toBe('tab:tab-session-1');
    });

    test('falls back to an empty list when loading browser sessions fails', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        browser.sessions.getRecentlyClosed.mockRejectedValue(new Error('boom'));

        await expect(loadBrowserSessions()).resolves.toEqual([]);

        consoleErrorSpy.mockRestore();
    });

    test('restores a normalized session collection through browser.sessions.restore', async () => {
        const collection = {
            sessionId: 'window-session-1',
            sessionEntryKey: 'window:window-session-1',
        };

        await restoreBrowserSession(collection);

        expect(browser.sessions.restore).toHaveBeenCalledWith('window-session-1');
    });

    test('subscribes to native session changes', async () => {
        const callback = jest.fn();
        const unsubscribe = subscribeToBrowserSessions(callback);

        browser.sessions.onChanged.trigger();

        expect(callback).toHaveBeenCalledTimes(1);

        unsubscribe();
        browser.sessions.onChanged.trigger();

        expect(callback).toHaveBeenCalledTimes(1);
    });

    test('counts normalized browser session groups', () => {
        expect(getBrowserSessionCount([
            { collections: [{ uid: 'one' }] },
            { collections: [{ uid: 'two' }] },
            { collections: [{ uid: 'three' }] },
        ])).toBe(3);
    });
});
