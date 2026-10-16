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

describe('ExpandedCollectionData — merge saved groups by title and color', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.get.mockResolvedValue({ chkColEditIgnoreDuplicateGroups: true });
        browser.tabs.query.mockResolvedValue([]);
    });

    test.each(['Add Current Tab', 'Add Selected Tabs', 'Add All Tabs'])(
        '%s keeps different-title groups with the same color distinct', async (action) => {
            browser.tabs.query.mockResolvedValue(action === 'Add Selected Tabs' ? [{ id: 1 }, { id: 2 }] : []);
            const savedGroup = { uid: 'saved', id: 10, title: 'Work', color: 'blue' };
            const liveGroup = { uid: 'live', id: 20, title: 'Travel', color: 'blue' };
            const collection = { uid: 'col', name: 'Synthetic', chromeGroups: [savedGroup],
                tabs: [makeTab('old', { groupUid: 'saved', groupId: 10 })] };
            getCurrentTabsAndGroups.mockResolvedValue({ chromeGroups: [liveGroup],
                tabs: [makeTab('new', { groupUid: 'live', groupId: 20 })] });
            const update = jest.fn();
            await renderExpanded(collection, update);
            await act(async () => fireEvent.click(screen.getByText(action)));
            expect(getCurrentTabsAndGroups).toHaveBeenCalledWith('', action !== 'Add All Tabs');
            const result = update.mock.calls[0][0];
            expect(result.chromeGroups).toEqual([savedGroup, liveGroup]);
            expect(result.tabs.map(t => t.groupUid)).toEqual(['saved', 'live']);
            expect(collection.tabs).toHaveLength(1);
        },
    );

    test('keeps same-title groups with different colors distinct', async () => {
        const saved = { uid: 'saved', id: 10, title: 'Work', color: 'blue' };
        const live = { uid: 'live', id: 20, title: 'Work', color: 'red' };
        getCurrentTabsAndGroups.mockResolvedValue({ chromeGroups: [live],
            tabs: [makeTab('new', { groupUid: 'live', groupId: 20 })] });
        const update = jest.fn();
        await renderExpanded({ uid: 'col', name: 'Synthetic', chromeGroups: [saved],
            tabs: [makeTab('old', { groupUid: 'saved', groupId: 10 })] }, update);
        await act(async () => fireEvent.click(screen.getByText('Add All Tabs')));
        expect(update.mock.calls[0][0].chromeGroups).toEqual([saved, live]);
    });
});

describe('ExpandedCollectionData — merged membership integrity', () => {
    test.each([true, false])('normalizes numeric membership when stable links are present: %s', async (stable) => {
        jest.clearAllMocks();
        browser.tabs.query.mockResolvedValue([]);
        browser.storage.local.get.mockResolvedValue({ chkColEditIgnoreDuplicateGroups: true });
        const saved = { uid: 'saved', id: 10, title: 'Work', color: 'blue' };
        const live = { uid: 'live', id: 20, title: 'Work', color: 'blue' };
        const old = makeTab('old', { groupId: 10, ...(stable ? { groupUid: 'saved' } : {}) });
        const incoming = makeTab('new', { groupId: 20, ...(stable ? { groupUid: 'live' } : {}) });
        getCurrentTabsAndGroups.mockResolvedValue({ chromeGroups: [live], tabs: [incoming] });
        const update = jest.fn();
        await renderExpanded({ uid: 'col', name: 'Synthetic', chromeGroups: [saved], tabs: [old] }, update);
        await act(async () => fireEvent.click(screen.getByText('Add All Tabs')));
        const result = update.mock.calls[0][0];
        expect(result.chromeGroups).toEqual([saved]);
        expect(result.tabs.map(t => t.uid)).toEqual(['old', 'new']);
        expect(result.tabs[1]).toMatchObject({ groupUid: 'saved', groupId: 10 });
        expect(incoming.groupId).toBe(20);
        expect(incoming.groupUid).toBe(stable ? 'live' : undefined);
    });
});

test('group-only open uses the shared opening path and disables collection tracking', async () => {
    jest.clearAllMocks();
    browser.tabs.query.mockResolvedValue([]);
    browser.storage.local.get.mockResolvedValue({ chkOpenNewWindow: false });
    browser.windows.getCurrent.mockResolvedValue({ id: 300, tabs: [] });
    browser.runtime.sendMessage.mockResolvedValue({ success: true, tabsOpened: 1, groupsFailed: 1 });
    const group = { uid: 'saved', id: 10, title: 'Work', color: 'blue' };
    const grouped = makeTab('grouped', { groupUid: 'saved', groupId: 10 });
    await renderExpanded({ uid: 'col', name: 'Synthetic', chromeGroups: [group],
        tabs: [grouped, makeTab('ungrouped')] }, jest.fn());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open all tabs in Work' })));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'openTabs', trackOpenedWindow: false,
        collection: expect.objectContaining({ tabs: [grouped], chromeGroups: [group] }),
    }));
});
