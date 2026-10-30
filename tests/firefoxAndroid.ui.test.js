/** @jest-environment jsdom */
// Firefox for Android: the UI must hide features whose browser APIs are
// missing (windows, tabGroups, sessions) and save the single tab strip.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// The whole file runs as Firefox for Android: remove the namespaces before
// any app module is required (registries such as the palette's AI actions
// are computed at import time).
const ANDROID_MISSING = ['windows', 'tabGroups', 'sessions'];
const saved = {};
ANDROID_MISSING.forEach((ns) => {
    saved[ns] = browser[ns];
    delete browser[ns];
});

describe('Firefox for Android UI', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({});
    });

    afterEach(() => {
        browser.tabs.query.mockReset();
        browser.tabs.query.mockResolvedValue([]);
    });

    afterAll(() => {
        ANDROID_MISSING.forEach((ns) => { browser[ns] = saved[ns]; });
    });

    test('capability helpers report the reduced surface', () => {
        const platform = require('../app/utils/platform');
        expect(platform.isSingleWindowBrowser()).toBe(true);
        expect(platform.hasTabGroups()).toBe(false);
        expect(platform.hasRecentlyClosed()).toBe(false);
        expect(platform.isSupported('windows')).toBe(false);
        expect(platform.isSupported(undefined)).toBe(true);
        expect(platform.faviconServiceUrl('https://news.example.com/a')).toContain('domain=news.example.com');
        expect(platform.faviconServiceUrl('about:blank')).toBe('');
    });

    test('getCurrentTabsAndGroups saves every web tab, skips extension/about pages, and fills favicons', async () => {
        browser.tabs.query.mockResolvedValue([
            { id: 1, url: 'https://a.example/', title: 'A', windowId: 11 },
            { id: 2, url: 'https://b.example/', title: 'B', windowId: 12, favIconUrl: 'https://b.example/icon.png' },
            { id: 3, url: 'chrome-extension://test/fullpage.html', title: 'Tabox', windowId: 13 },
            { id: 4, url: 'about:home', title: 'Home', windowId: 14 },
        ]);
        const { getCurrentTabsAndGroups } = require('../app/utils');
        const collection = await getCurrentTabsAndGroups('Phone tabs');

        expect(browser.tabs.query).toHaveBeenCalledWith({});
        expect(collection.tabs.map((t) => t.url)).toEqual(['https://a.example/', 'https://b.example/']);
        expect(collection.tabs[0].favIconUrl).toContain('domain=a.example');
        expect(collection.tabs[1].favIconUrl).toBe('https://b.example/icon.png');
        expect(collection.chromeGroups).toEqual([]);
    });

    test('saving the single tab strip retains deferred titles before excluding extension pages', async () => {
        const url = 'https://synthetic.example/video';
        const title = 'Synthetic 日本語 100%';
        const wrapper = `moz-extension://test/deferedLoading.html#${encodeURIComponent(JSON.stringify({ url, title }))}`;
        browser.runtime.getURL.mockImplementation(path => `moz-extension://test/${path}`);
        browser.tabs.query.mockResolvedValue([
            { id: 1, url: wrapper, title: 'synthetic.example (click to load)' },
            { id: 2, url: 'moz-extension://test/fullpage.html', title: 'Tabox' },
        ]);
        const { getCurrentTabsAndGroups } = require('../app/utils');
        const collection = await getCurrentTabsAndGroups('Synthetic phone tabs');
        expect(collection.tabs).toHaveLength(1);
        expect(collection.tabs[0]).toMatchObject({ url, title });
    });

    test('command palette hides Smart Tab Grouping, Recently Closed and window-bound settings', async () => {
        const { Provider, createStore } = require('jotai');
        const CommandPalette = require('../app/CommandPalette').default;
        const { commandPaletteOpenState } = require('../app/atoms/commandPaletteState');
        const store = createStore();
        store.set(commandPaletteOpenState, true);
        render(
            <Provider store={store}>
                <CommandPalette
                    collections={[]}
                    folders={[]}
                    folderNameMap={{}}
                    onCreateFolder={jest.fn()}
                    onImport={jest.fn()}
                    onExportAll={jest.fn()}
                    onOpenFullPage={jest.fn()}
                    onRestoreSession={jest.fn()}
                    onCollectionAction={jest.fn()}
                    onOpenAiTool={jest.fn()}
                />
            </Provider>,
        );
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');

        fireEvent.change(input, { target: { value: 'ai' } });
        await waitFor(() => expect(screen.getByText('Auto rename collections')).toBeInTheDocument());
        expect(screen.queryByText('Smart Tab Grouping')).not.toBeInTheDocument();

        fireEvent.change(input, { target: { value: 'recently closed' } });
        await waitFor(() => expect(screen.queryByText(/Recently Closed/)).not.toBeInTheDocument());

        fireEvent.change(input, { target: { value: 'auto update' } });
        await waitFor(() => expect(screen.queryByText('Auto Update Collections')).not.toBeInTheDocument());
    });
});
