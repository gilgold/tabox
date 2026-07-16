/**
 * Fix round 3 (task-13-report.md "## Fix round 3"): CollectionListOptions'
 * global sort (handleSort) cleared `order` for every collection via
 * batchUpdateCollections, including collections inside a read-only shared
 * folder - overwriting an ordering the read-only member has no permission to
 * change. The fix excludes those collections from the clearing batch entirely.
 *
 * This file mocks storageUtils fully (instead of relying on the real,
 * webextension-mock-backed implementation used by CollectionListOptions.test.js)
 * so the batchUpdateCollections payload can be asserted on directly.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { CollectionListOptions } from '../app/CollectionListOptions';
import { settingsDataState } from '../app/atoms/globalAppSettingsState';

jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
    loadAllFolders: jest.fn(),
    batchUpdateCollections: jest.fn(),
}));

const storageUtils = require('../app/utils/storageUtils');

describe('CollectionListOptions sort guard for read-only shared folders', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        storageUtils.batchUpdateCollections.mockResolvedValue(true);
        storageUtils.loadAllFolders.mockResolvedValue([]);
    });

    test('excludes a collection inside a read-only shared folder from the order-clearing batch', async () => {
        const writableCollection = { uid: 'writable-1', name: 'Writable', parentId: null, order: 2, lastUpdated: 10 };
        const readOnlyCollection = { uid: 'shared-1', name: 'Shared RO', parentId: 'folder-shared', order: 1, lastUpdated: 20 };

        storageUtils.loadAllCollections
            .mockResolvedValueOnce([writableCollection, readOnlyCollection])
            .mockResolvedValueOnce([writableCollection, readOnlyCollection]);

        const updateRemoteData = jest.fn();
        const store = createStore();
        store.set(settingsDataState, [writableCollection, readOnlyCollection]);

        const { container } = render(
            <Provider store={store}>
                <CollectionListOptions
                    addCollection={jest.fn()}
                    updateRemoteData={updateRemoteData}
                    folders={[
                        { uid: 'folder-shared', name: 'Shared Folder', shared: { folderId: 'folder-shared', role: 'read' } },
                    ]}
                />
            </Provider>,
        );

        await screen.findByText('Date');

        const directionButton = container.querySelector('#toolbar-sort-direction');
        fireEvent.click(directionButton);

        await waitFor(() => {
            expect(storageUtils.batchUpdateCollections).toHaveBeenCalledTimes(1);
        });

        const payload = storageUtils.batchUpdateCollections.mock.calls[0][0];
        expect(payload.some((c) => c.uid === 'shared-1')).toBe(false);
        expect(payload).toEqual([
            expect.objectContaining({ uid: 'writable-1', order: null }),
        ]);

        await waitFor(() => {
            expect(updateRemoteData).toHaveBeenCalled();
        });
        expect(updateRemoteData).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ uid: 'shared-1', order: 1 }),
        ]));

        // loadAllFolders() should not have been needed since props.folders was supplied.
        expect(storageUtils.loadAllFolders).not.toHaveBeenCalled();
    });

    test('falls back to loading folders from storage when props.folders is not supplied', async () => {
        const writableCollection = { uid: 'writable-2', name: 'Writable', parentId: null, order: 2, lastUpdated: 10 };
        const readOnlyCollection = { uid: 'shared-2', name: 'Shared RO', parentId: 'folder-shared-2', order: 1, lastUpdated: 20 };

        storageUtils.loadAllFolders.mockResolvedValue([
            { uid: 'folder-shared-2', name: 'Shared Folder', shared: { folderId: 'folder-shared-2', role: 'read' } },
        ]);
        storageUtils.loadAllCollections
            .mockResolvedValueOnce([writableCollection, readOnlyCollection])
            .mockResolvedValueOnce([writableCollection, readOnlyCollection]);

        const updateRemoteData = jest.fn();
        const store = createStore();
        store.set(settingsDataState, [writableCollection, readOnlyCollection]);

        const { container } = render(
            <Provider store={store}>
                <CollectionListOptions
                    addCollection={jest.fn()}
                    updateRemoteData={updateRemoteData}
                />
            </Provider>,
        );

        await screen.findByText('Date');

        const directionButton = container.querySelector('#toolbar-sort-direction');
        fireEvent.click(directionButton);

        await waitFor(() => {
            expect(storageUtils.batchUpdateCollections).toHaveBeenCalledTimes(1);
        });

        const payload = storageUtils.batchUpdateCollections.mock.calls[0][0];
        expect(payload.some((c) => c.uid === 'shared-2')).toBe(false);
        expect(storageUtils.loadAllFolders).toHaveBeenCalled();
    });
});
