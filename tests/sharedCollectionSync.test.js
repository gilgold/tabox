jest.mock('../app/utils/storageUtils', () => ({
    updateCollectionsOrder: jest.fn(async () => true),
    updateFolderCollectionCount: jest.fn(async () => true),
}));

import { persistCollectionLayoutChanges } from '../app/utils/sharedCollectionSync';
import { updateCollectionsOrder, updateFolderCollectionCount } from '../app/utils/storageUtils';

describe('persistCollectionLayoutChanges', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('uses the same persisted collection layout flow for popup and full-page reorder sync', async () => {
        const updateRemoteData = jest.fn(async () => true);
        const setOptimisticCollections = jest.fn();
        const nextCollections = [
            { uid: 'collection-1', name: 'One', parentId: 'folder-1', order: 1, lastUpdated: 10 },
            { uid: 'collection-2', name: 'Two', parentId: 'folder-1', order: 0, lastUpdated: 20 },
            { uid: 'collection-3', name: 'Three', parentId: null, order: 0, lastUpdated: 30 },
        ];

        await persistCollectionLayoutChanges({
            nextCollections,
            affectedParentIds: ['folder-1', null, 'folder-1'],
            folderUidSet: new Set(['folder-1']),
            updateRemoteData,
            setOptimisticCollections,
        });

        expect(updateCollectionsOrder).toHaveBeenNthCalledWith(1, [
            { uid: 'collection-1', name: 'One', parentId: 'folder-1', order: 1, lastUpdated: 10 },
            { uid: 'collection-2', name: 'Two', parentId: 'folder-1', order: 0, lastUpdated: 20 },
        ]);
        expect(updateCollectionsOrder).toHaveBeenNthCalledWith(2, [
            { uid: 'collection-3', name: 'Three', parentId: null, order: 0, lastUpdated: 30 },
        ]);
        expect(updateFolderCollectionCount).toHaveBeenCalledWith('folder-1');
        expect(setOptimisticCollections).toHaveBeenCalledWith(nextCollections);
        expect(updateRemoteData).toHaveBeenCalledWith(nextCollections);
    });

    test('preserves dragged sibling order even when collection order fields are stale', async () => {
        const updateRemoteData = jest.fn(async () => true);
        const nextCollections = [
            { uid: 'collection-2', name: 'Two', parentId: null, order: 1, lastUpdated: 20 },
            { uid: 'collection-1', name: 'One', parentId: null, order: 0, lastUpdated: 10 },
            { uid: 'collection-3', name: 'Three', parentId: 'folder-1', order: 0, lastUpdated: 30 },
        ];

        await persistCollectionLayoutChanges({
            nextCollections,
            affectedParentIds: [null],
            folderUidSet: new Set(['folder-1']),
            updateRemoteData,
        });

        expect(updateCollectionsOrder).toHaveBeenCalledWith([
            { uid: 'collection-2', name: 'Two', parentId: null, order: 1, lastUpdated: 20 },
            { uid: 'collection-1', name: 'One', parentId: null, order: 0, lastUpdated: 10 },
        ]);
        expect(updateRemoteData).toHaveBeenCalledWith(nextCollections);
    });
});
