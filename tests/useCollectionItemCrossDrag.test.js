import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { dragSessionState } from '../app/atoms/animationsState';
import DroppableCollection from '../app/DroppableCollection';
import useCollectionItemCrossDrag from '../app/useCollectionItemCrossDrag';

const makeTab = (uid, overrides = {}) => ({
    uid,
    title: `Tab ${uid}`,
    url: `https://${uid}.example.com`,
    groupId: -1,
    ...overrides,
});

function PopupHarness({ sourceCollection, targetCollection, updateCollection, onDataUpdate }) {
    const findCollectionByUid = React.useCallback((uid) => {
        if (uid === sourceCollection.uid) {
            return { collection: sourceCollection };
        }

        if (uid === targetCollection.uid) {
            return { collection: targetCollection };
        }

        return { collection: null };
    }, [sourceCollection, targetCollection]);

    useCollectionItemCrossDrag({
        findCollectionByUid,
        updateCollection,
        onDataUpdate,
    });

    return (
        <div>
            <DroppableCollection collection={sourceCollection}>
                <div>Source</div>
            </DroppableCollection>
            <DroppableCollection collection={targetCollection}>
                <div>Target</div>
            </DroppableCollection>
        </div>
    );
}

function FullPageHarness(props) {
    return <PopupHarness {...props} />;
}

describe('useCollectionItemCrossDrag', () => {
    const originalElementsFromPoint = document.elementsFromPoint;

    afterEach(() => {
        document.elementsFromPoint = originalElementsFromPoint;
    });

    test('moves a single tab between collections in the popup harness', async () => {
        const sourceCollection = {
            uid: 'source',
            tabs: [makeTab('tab-a')],
            chromeGroups: [],
        };
        const targetCollection = {
            uid: 'target',
            tabs: [makeTab('tab-b')],
            chromeGroups: [],
        };
        const updateCollection = jest.fn(() => Promise.resolve());
        const onDataUpdate = jest.fn(() => Promise.resolve());
        const store = createStore();

        store.set(dragSessionState, {
            kind: 'tab',
            itemId: 'tab-a',
            sourceCollectionUid: sourceCollection.uid,
            snapshot: {
                tab: sourceCollection.tabs[0],
            },
            pointer: { x: 10, y: 10 },
            overCollectionUid: null,
        });

        const { container } = render(
            <Provider store={store}>
                <PopupHarness
                    sourceCollection={sourceCollection}
                    targetCollection={targetCollection}
                    updateCollection={updateCollection}
                    onDataUpdate={onDataUpdate}
                />
            </Provider>,
        );

        document.elementsFromPoint = jest.fn(() => [container.querySelector('[data-collection-uid="target"]')]);

        fireEvent.mouseUp(document, { clientX: 12, clientY: 12 });

        await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2));

        expect(updateCollection.mock.calls[0][0].tabs).toHaveLength(0);
        expect(updateCollection.mock.calls[1][0].tabs.map((tab) => tab.uid)).toEqual(['tab-b', 'tab-a']);
        expect(onDataUpdate).toHaveBeenCalledTimes(1);
        expect(store.get(dragSessionState)).toBeNull();
    });

    test('moves a whole group between collections in the full-page harness', async () => {
        const group = {
            uid: 'group-1',
            id: 1,
            title: 'Work',
            color: 'blue',
        };
        const sourceCollection = {
            uid: 'source',
            tabs: [
                makeTab('tab-a', { groupUid: group.uid, groupId: group.id }),
                makeTab('tab-c', { groupUid: group.uid, groupId: group.id }),
            ],
            chromeGroups: [group],
        };
        const targetCollection = {
            uid: 'target',
            tabs: [makeTab('tab-b')],
            chromeGroups: [],
        };
        const updateCollection = jest.fn(() => Promise.resolve());
        const onDataUpdate = jest.fn(() => Promise.resolve());
        const store = createStore();

        store.set(dragSessionState, {
            kind: 'group',
            itemId: group.uid,
            sourceCollectionUid: sourceCollection.uid,
            snapshot: {
                group,
                tabs: sourceCollection.tabs,
            },
            pointer: { x: 10, y: 10 },
            overCollectionUid: null,
        });

        const { container } = render(
            <Provider store={store}>
                <FullPageHarness
                    sourceCollection={sourceCollection}
                    targetCollection={targetCollection}
                    updateCollection={updateCollection}
                    onDataUpdate={onDataUpdate}
                />
            </Provider>,
        );

        document.elementsFromPoint = jest.fn(() => [container.querySelector('[data-collection-uid="target"]')]);

        fireEvent.mouseUp(document, { clientX: 20, clientY: 20 });

        await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2));

        expect(updateCollection.mock.calls[0][0].chromeGroups).toHaveLength(0);
        expect(updateCollection.mock.calls[1][0].chromeGroups.map((item) => item.uid)).toEqual([group.uid]);
        expect(updateCollection.mock.calls[1][0].tabs.map((tab) => tab.uid)).toEqual(['tab-b', 'tab-a', 'tab-c']);
        expect(onDataUpdate).toHaveBeenCalledTimes(1);
        expect(store.get(dragSessionState)).toBeNull();
    });

    test('does not rewrite the drag session atom when the hovered collection is unchanged', async () => {
        const sourceCollection = { uid: 'source', tabs: [makeTab('tab-a')], chromeGroups: [] };
        const targetCollection = { uid: 'target', tabs: [], chromeGroups: [] };
        const store = createStore();
        const rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });

        store.set(dragSessionState, {
            kind: 'tab',
            itemId: 'tab-a',
            sourceCollectionUid: sourceCollection.uid,
            snapshot: { tab: sourceCollection.tabs[0] },
            pointer: { x: 10, y: 10 },
            overCollectionUid: null,
        });

        const { container } = render(
            <Provider store={store}>
                <PopupHarness
                    sourceCollection={sourceCollection}
                    targetCollection={targetCollection}
                    updateCollection={jest.fn(() => Promise.resolve())}
                    onDataUpdate={jest.fn(() => Promise.resolve())}
                />
            </Provider>,
        );

        document.elementsFromPoint = jest.fn(() => [container.querySelector('[data-collection-uid="target"]')]);

        fireEvent.mouseMove(document, { clientX: 20, clientY: 20 });
        const sessionAfterFirstMove = store.get(dragSessionState);
        expect(sessionAfterFirstMove.overCollectionUid).toBe('target');

        fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
        // Same hovered collection — the atom value must be referentially unchanged.
        expect(store.get(dragSessionState)).toBe(sessionAfterFirstMove);

        rafSpy.mockRestore();
    });

    test('does not highlight or transfer to a collection behind the open detail panel', async () => {
        const sourceCollection = {
            uid: 'source',
            tabs: [makeTab('tab-a')],
            chromeGroups: [],
        };
        const targetCollection = {
            uid: 'target',
            tabs: [makeTab('tab-b')],
            chromeGroups: [],
        };
        const updateCollection = jest.fn(() => Promise.resolve());
        const onDataUpdate = jest.fn(() => Promise.resolve());
        const store = createStore();

        store.set(dragSessionState, {
            kind: 'tab',
            itemId: 'tab-a',
            sourceCollectionUid: sourceCollection.uid,
            snapshot: {
                tab: sourceCollection.tabs[0],
            },
            pointer: { x: 10, y: 10 },
            overCollectionUid: null,
        });

        const { container } = render(
            <Provider store={store}>
                <PopupHarness
                    sourceCollection={sourceCollection}
                    targetCollection={targetCollection}
                    updateCollection={updateCollection}
                    onDataUpdate={onDataUpdate}
                />
            </Provider>,
        );

        const panel = document.createElement('div');
        panel.className = 'collection-detail-panel open';
        const panelContent = document.createElement('div');
        panel.appendChild(panelContent);
        document.body.appendChild(panel);

        document.elementsFromPoint = jest.fn(() => [
            panelContent,
            container.querySelector('[data-collection-uid="target"]'),
        ]);

        fireEvent.mouseUp(document, { clientX: 12, clientY: 12 });

        await waitFor(() => expect(store.get(dragSessionState)).toBeNull());

        expect(updateCollection).not.toHaveBeenCalled();
        expect(onDataUpdate).not.toHaveBeenCalled();

        panel.remove();
    });
});
