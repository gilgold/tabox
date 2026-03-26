jest.mock('../static/globals', () => ({
    browser: {
        system: {
            display: {
                getInfo: jest.fn(async () => [
                    { bounds: { top: 0, left: 0, width: 1600, height: 900 } },
                ]),
            },
        },
        windows: {
            create: jest.fn(async (options = {}) => ({ id: 101, ...options })),
        },
        runtime: {
            sendMessage: jest.fn(async () => ({ success: true })),
        },
    },
}));

jest.mock('../app/utils/storageUtils', () => ({
    batchUpdateCollections: jest.fn(async () => true),
}));

import { browser } from '../static/globals';
import { batchUpdateCollections } from '../app/utils/storageUtils';
import {
    buildCollectionSubsetExport,
    openCollectionsInSequence,
} from '../app/utils/collectionBulkActions';

describe('buildCollectionSubsetExport', () => {
    test('includes only folders referenced by the selected collections', () => {
        const payload = buildCollectionSubsetExport({
            collections: [
                { uid: 'collection-a', name: 'A', parentId: 'folder-1', tabs: [] },
                { uid: 'collection-b', name: 'B', parentId: null, tabs: [] },
            ],
            folders: [
                { uid: 'folder-1', name: 'Folder One' },
                { uid: 'folder-2', name: 'Folder Two' },
            ],
        });

        expect(payload).toEqual(expect.objectContaining({
            type: 'full_export',
            collections: [
                expect.objectContaining({ uid: 'collection-a' }),
                expect.objectContaining({ uid: 'collection-b' }),
            ],
            folders: [
                expect.objectContaining({ uid: 'folder-1' }),
            ],
            stats: expect.objectContaining({
                totalCollections: 2,
                totalFolders: 1,
                collectionsInFolders: 1,
                rootCollections: 1,
            }),
        }));
    });
});

describe('openCollectionsInSequence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('opens each collection sequentially and persists lastOpened for successes', async () => {
        const collections = [
            {
                uid: 'collection-a',
                name: 'Collection A',
                tabs: [],
                window: { top: 10, left: 10, width: 800, height: 600 },
            },
            {
                uid: 'collection-b',
                name: 'Collection B',
                tabs: [],
            },
        ];

        const result = await openCollectionsInSequence(collections);

        expect(browser.windows.create).toHaveBeenCalledTimes(2);
        expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(2);
        expect(batchUpdateCollections).toHaveBeenCalledWith([
            expect.objectContaining({ uid: 'collection-a', lastOpened: expect.any(Number) }),
            expect.objectContaining({ uid: 'collection-b', lastOpened: expect.any(Number) }),
        ]);
        expect(result).toEqual(expect.objectContaining({
            openedCount: 2,
            failedCount: 0,
        }));
    });

    test('records failures without aborting later collections', async () => {
        browser.windows.create
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ id: 102 });

        const result = await openCollectionsInSequence([
            { uid: 'collection-a', name: 'Collection A', tabs: [] },
            { uid: 'collection-b', name: 'Collection B', tabs: [] },
        ]);

        expect(result.failedCollections).toEqual(['Collection A']);
        expect(result.openedCount).toBe(1);
        expect(batchUpdateCollections).toHaveBeenCalledWith([
            expect.objectContaining({ uid: 'collection-b', lastOpened: expect.any(Number) }),
        ]);
    });
});
