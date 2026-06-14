jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
    batchUpdateCollections: jest.fn(),
    updateFolderCollectionCount: jest.fn(),
}));
jest.mock('../app/utils/folderOperations', () => ({
    createFolder: jest.fn(),
    deleteFolder: jest.fn(),
}));
jest.mock('../app/utils/sharedSync', () => ({ triggerBackgroundSync: jest.fn() }));

import { browser } from '../static/globals';
import {
    loadAllCollections, batchUpdateCollections, updateFolderCollectionCount,
} from '../app/utils/storageUtils';
import { createFolder, deleteFolder } from '../app/utils/folderOperations';
import { applyAutoArrange, undoAutoArrange, AUTO_ARRANGE_UNDO_KEY } from '../app/ai/autoArrangeApply';

// In-memory store that backs browser.storage.local mocks for this test file.
let store = {};

function setupStorageMocks() {
    store = {};
    browser.storage.local.get = jest.fn(async (keys) => {
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
        return { ...store };
    });
    browser.storage.local.set = jest.fn(async (items) => { Object.assign(store, items); });
    browser.storage.local.remove = jest.fn(async (keys) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        ks.forEach((k) => delete store[k]);
    });
}

describe('applyAutoArrange', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        setupStorageMocks();
        batchUpdateCollections.mockResolvedValue(true);
        updateFolderCollectionCount.mockResolvedValue(true);
        loadAllCollections.mockResolvedValue([
            { uid: 'c1', parentId: null },
            { uid: 'c2', parentId: null },
            { uid: 'c3', parentId: 'f-old' },
        ]);
        createFolder.mockImplementation(async (name) => ({ uid: `new-${name}`, name }));
    });

    test('creates new folders once per unique name and batch-moves collections', async () => {
        const plan = {
            assignments: [
                { collectionId: 'c1', existingFolderId: 'f-dev', newFolderName: null },
                { collectionId: 'c2', existingFolderId: null, newFolderName: 'Cooking' },
                { collectionId: 'c3', existingFolderId: null, newFolderName: 'Cooking' },
            ],
        };
        const result = await applyAutoArrange(plan);

        expect(createFolder).toHaveBeenCalledTimes(1);
        // New folders are created collapsed (3rd arg true) with a color from the palette.
        expect(createFolder).toHaveBeenCalledWith('Cooking', expect.any(String), true);
        expect(result.foldersCreated).toBe(1);
        expect(result.collectionsMoved).toBe(3);

        expect(batchUpdateCollections).toHaveBeenCalledTimes(1);
        const moved = batchUpdateCollections.mock.calls[0][0];
        const byUid = Object.fromEntries(moved.map((m) => [m.uid, m.parentId]));
        expect(byUid).toEqual({ c1: 'f-dev', c2: 'new-Cooking', c3: 'new-Cooking' });

        const stored = (await browser.storage.local.get(AUTO_ARRANGE_UNDO_KEY))[AUTO_ARRANGE_UNDO_KEY];
        expect(stored.createdFolderUids).toEqual(['new-Cooking']);
        const prior = Object.fromEntries(stored.moves.map((m) => [m.uid, m.prevParentId]));
        expect(prior).toEqual({ c1: null, c2: null, c3: 'f-old' });
    });

    test('gives each newly created folder a distinct color and creates them collapsed', async () => {
        const plan = {
            assignments: [
                { collectionId: 'c1', existingFolderId: null, newFolderName: 'Cooking' },
                { collectionId: 'c2', existingFolderId: null, newFolderName: 'Reading' },
                { collectionId: 'c3', existingFolderId: null, newFolderName: 'Travel' },
            ],
        };
        await applyAutoArrange(plan);

        expect(createFolder).toHaveBeenCalledTimes(3);
        const colors = createFolder.mock.calls.map((call) => call[1]);
        expect(new Set(colors).size).toBe(3); // not all the same color
        createFolder.mock.calls.forEach((call) => expect(call[2]).toBe(true)); // collapsed
    });
});

describe('undoAutoArrange', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        setupStorageMocks();
        batchUpdateCollections.mockResolvedValue(true);
        updateFolderCollectionCount.mockResolvedValue(true);
        deleteFolder.mockResolvedValue(true);
    });

    test('restores prior parentIds and deletes only empty created folders', async () => {
        const snapshot = {
            moves: [
                { uid: 'c1', prevParentId: null },
                { uid: 'c2', prevParentId: null },
            ],
            createdFolderUids: ['new-Cooking', 'new-Keep'],
        };
        loadAllCollections.mockResolvedValue([
            { uid: 'c1', parentId: null },
            { uid: 'c2', parentId: null },
            { uid: 'cX', parentId: 'new-Keep' },
        ]);
        await browser.storage.local.set({ [AUTO_ARRANGE_UNDO_KEY]: snapshot });

        await undoAutoArrange(snapshot);

        const restored = batchUpdateCollections.mock.calls[0][0];
        const byUid = Object.fromEntries(restored.map((m) => [m.uid, m.parentId]));
        expect(byUid).toEqual({ c1: null, c2: null });

        expect(deleteFolder).toHaveBeenCalledTimes(1);
        expect(deleteFolder).toHaveBeenCalledWith('new-Cooking', true);

        const cleared = (await browser.storage.local.get(AUTO_ARRANGE_UNDO_KEY))[AUTO_ARRANGE_UNDO_KEY];
        expect(cleared).toBeUndefined();
    });
});
