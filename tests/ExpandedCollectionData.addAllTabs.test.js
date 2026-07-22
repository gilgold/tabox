import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import ExpandedCollectionData from '../app/ExpandedCollectionData';
import { getCurrentTabsAndGroups } from '../app/utils';

jest.mock('../app/utils', () => ({
    ...jest.requireActual('../app/utils'),
    getCurrentTabsAndGroups: jest.fn(),
}));

jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn().mockResolvedValue([]),
}));

jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
}));

const makeTab = (uid, overrides = {}) => ({
    uid,
    id: uid,
    title: uid,
    url: `https://example.com/${uid}`,
    pinned: false,
    ...overrides,
});

const renderExpanded = async (collection, updateCollection) => {
    await act(async () => {
        render(
            <Provider>
                <ExpandedCollectionData
                    collection={collection}
                    updateCollection={updateCollection}
                    updateRemoteData={jest.fn()}
                    search=""
                />
            </Provider>,
        );
    });
};

describe('ExpandedCollectionData — Add All Tabs pinned ordering', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.get.mockResolvedValue({});
    });

    test('pinned tabs from the window are placed at the top of the collection', async () => {
        const collection = {
            uid: 'col-1',
            name: 'My Collection',
            tabs: [makeTab('existing-1'), makeTab('existing-2')],
            chromeGroups: [],
        };
        getCurrentTabsAndGroups.mockResolvedValue({
            tabs: [
                makeTab('win-pinned-1', { pinned: true }),
                makeTab('win-pinned-2', { pinned: true }),
                makeTab('win-normal-1'),
            ],
            chromeGroups: [],
        });
        const updateCollection = jest.fn();

        await renderExpanded(collection, updateCollection);

        await act(async () => {
            fireEvent.click(screen.getByText('Add All Tabs'));
        });

        expect(updateCollection).toHaveBeenCalledTimes(1);
        const savedTabs = updateCollection.mock.calls[0][0].tabs;
        expect(savedTabs.map((tab) => tab.uid)).toEqual([
            'win-pinned-1',
            'win-pinned-2',
            'existing-1',
            'existing-2',
            'win-normal-1',
        ]);
    });

    test('new pinned tabs go after existing pinned tabs but before unpinned tabs', async () => {
        const collection = {
            uid: 'col-1',
            name: 'My Collection',
            tabs: [
                makeTab('existing-pinned', { pinned: true }),
                makeTab('existing-1'),
            ],
            chromeGroups: [],
        };
        getCurrentTabsAndGroups.mockResolvedValue({
            tabs: [
                makeTab('win-pinned-1', { pinned: true }),
                makeTab('win-normal-1'),
            ],
            chromeGroups: [],
        });
        const updateCollection = jest.fn();

        await renderExpanded(collection, updateCollection);

        await act(async () => {
            fireEvent.click(screen.getByText('Add All Tabs'));
        });

        expect(updateCollection).toHaveBeenCalledTimes(1);
        const savedTabs = updateCollection.mock.calls[0][0].tabs;
        expect(savedTabs.map((tab) => tab.uid)).toEqual([
            'existing-pinned',
            'win-pinned-1',
            'existing-1',
            'win-normal-1',
        ]);
    });
});
