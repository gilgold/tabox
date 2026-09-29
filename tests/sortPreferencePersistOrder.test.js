/** @jest-environment jsdom */
/* global browser */
/**
 * Regression: sorting reverted a few seconds after clicking.
 *
 * handleSort (popup CollectionListOptions + full-page FPContentArea) used to
 * write the cleared collections to storage FIRST and persist the chosen sort
 * preference (currentSortValue / currentSortAscending) LAST. The collection
 * writes fire storage.onChanged, App's debounced reload re-reads the sort
 * preference from storage - still the OLD one - and re-sorts the list the old
 * way. Net effect: the list flips to the new order, then snaps back.
 *
 * The fix persists the preference before any collection write, so every
 * storage-driven reload already sees the new sort options.
 */

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';

jest.mock('javascript-time-ago', () => jest.fn().mockImplementation(() => ({
    format: jest.fn(() => 'Recently'),
})));

// Same lightweight stand-ins FPContentArea.test.js uses: the real bulk modals
// loop on setState under this minimal fixture and the card pulls in heavy deps.
jest.mock('../app/fullpage/FPCollectionCard', () => function MockFPCollectionCard({ collection }) {
    return <div>{collection.name}</div>;
});
jest.mock('../app/fullpage/BulkMoveCollectionsModal', () => () => null);
jest.mock('../app/fullpage/BulkDeleteCollectionsModal', () => () => null);
jest.mock('../app/fullpage/SaveCollectionModal', () => () => null);
jest.mock('../app/fullpage/LegacyImportPreviewModal', () => () => null);

jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    loadAllCollections: jest.fn(),
    loadAllFolders: jest.fn(),
    batchUpdateCollections: jest.fn(),
}));

import { CollectionListOptions } from '../app/CollectionListOptions';
import FPContentArea from '../app/fullpage/FPContentArea';
import { settingsDataState } from '../app/atoms/globalAppSettingsState';
import { sidebarNavigationState } from '../app/atoms/fullpageState';

const storageUtils = require('../app/utils/storageUtils');

const collections = [
    { uid: 'a', name: 'Alpha', parentId: null, order: 1, lastUpdated: 10, tabs: [] },
    { uid: 'b', name: 'Beta', parentId: null, order: 0, lastUpdated: 20, tabs: [] },
];

// Records the order in which the sort preference and collection writes hit storage.
const trackWriteOrder = () => {
    const calls = [];
    browser.storage.local.set.mockImplementation(async (items) => {
        if (items && 'currentSortValue' in items) calls.push('sortPreference');
    });
    storageUtils.batchUpdateCollections.mockImplementation(async () => {
        calls.push('batchUpdateCollections');
        return true;
    });
    return calls;
};

describe('sort preference is persisted before collections are rewritten', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        storageUtils.loadAllCollections.mockResolvedValue(collections);
        storageUtils.loadAllFolders.mockResolvedValue([]);
        browser.storage.local.get.mockImplementation(async (keys) => {
            const values = { currentSortValue: 'DATE', currentSortAscending: true, fpViewMode: 'grid', chkOpenNewWindow: false };
            if (Array.isArray(keys)) return keys.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {});
            if (typeof keys === 'string') return { [keys]: values[keys] };
            return values;
        });
    });

    test('popup: currentSortValue is written before batchUpdateCollections', async () => {
        const calls = trackWriteOrder();
        const store = createStore();
        store.set(settingsDataState, collections);

        const { container } = render(
            <Provider store={store}>
                <CollectionListOptions addCollection={jest.fn()} updateRemoteData={jest.fn()} folders={[]} />
            </Provider>,
        );
        await screen.findByText('Date');

        fireEvent.click(container.querySelector('#toolbar-sort-direction'));

        await waitFor(() => expect(storageUtils.batchUpdateCollections).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(calls).toContain('sortPreference'));

        expect(calls.indexOf('sortPreference')).toBeLessThan(calls.indexOf('batchUpdateCollections'));
        expect(browser.storage.local.set).toHaveBeenCalledWith({ currentSortValue: 'DATE', currentSortAscending: false });
    });

    test('full-page: currentSortValue is written before batchUpdateCollections', async () => {
        window.matchMedia = jest.fn().mockImplementation((query) => ({
            matches: false, media: query, onchange: null,
            addListener: jest.fn(), removeListener: jest.fn(),
            addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
        }));
        const calls = trackWriteOrder();
        const store = createStore();
        store.set(sidebarNavigationState, 'all');

        const { container } = render(
            <Provider store={store}>
                <FPContentArea
                    collections={collections}
                    currentWindows={[]}
                    sessionList={[]}
                    folders={[]}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    addCollection={jest.fn()}
                    addFolder={jest.fn()}
                    updateRemoteData={jest.fn()}
                    onDataUpdate={jest.fn()}
                    hasActiveFilters={false}
                    filters={{ recentlyOpenedActual: false, colors: [] }}
                    trackedCollectionUids={new Set()}
                    onViewModeChange={jest.fn()}
                    onFiltersChange={jest.fn()}
                    onFolderStateChange={jest.fn()}
                    onSelectCurrentWindow={jest.fn()}
                    onFocusCurrentWindow={jest.fn()}
                    onSaveCurrentWindow={jest.fn()}
                    onCloseCurrentWindow={jest.fn()}
                />
            </Provider>,
        );
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

        const toolbar = container.querySelector('.fp-toolbar-default');
        fireEvent.click(within(toolbar).getByRole('button', { name: 'Ascending' }));

        await waitFor(() => expect(storageUtils.batchUpdateCollections).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(calls).toContain('sortPreference'));

        expect(calls.indexOf('sortPreference')).toBeLessThan(calls.indexOf('batchUpdateCollections'));
        expect(browser.storage.local.set).toHaveBeenCalledWith({ currentSortValue: 'DATE', currentSortAscending: false });
    });
});
