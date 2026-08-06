// Regression: in-folder collection order diverged between shared-folder
// members. The share-creation payload used to upload records in index-key
// order with no explicit `order` field, so every member's display fell back
// to `lastUpdated` — a device-local value (accepting an invite stamps ALL
// collections with the same Date.now()). gatherCollectionsForShare must
// capture the sharer's CURRENT display order, stamp it as explicit
// sequential `order` values both into the uploaded payload and into the
// sharer's own local records, so every member sorts identically.
const { createBrowserHarness } = require('./helpers/browserHarness');

const mockBrowserProxy = new Proxy({}, {
    get(_target, property) {
        return global.browser?.[property];
    }
});

jest.mock('../static/globals', () => ({
    browser: mockBrowserProxy
}));

const { gatherCollectionsForShare } = require('../app/utils/sharedFolderActions');

const FOLDER_UID = 'folder-1';

const collection = (uid, lastUpdated, extra = {}) => ({
    uid,
    name: `Collection ${uid}`,
    parentId: FOLDER_UID,
    tabs: [],
    chromeGroups: [],
    lastUpdated,
    ...extra
});

describe('gatherCollectionsForShare', () => {
    let browser;

    const setup = (localData) => {
        browser = createBrowserHarness({ localData });
        global.browser = browser;
    };

    afterEach(() => {
        delete global.browser;
    });

    test('uploads in current display order with sequential explicit order stamped', async () => {
        // Default sort (DATE / lastUpdated, ascending): b (10) → c (20) → a (30)
        setup({
            collections_index: {
                a: { uid: 'a', name: 'Collection a', parentId: FOLDER_UID, lastUpdated: 30 },
                b: { uid: 'b', name: 'Collection b', parentId: FOLDER_UID, lastUpdated: 10 },
                c: { uid: 'c', name: 'Collection c', parentId: FOLDER_UID, lastUpdated: 20 },
                other: { uid: 'other', name: 'Elsewhere', parentId: null, lastUpdated: 5 }
            },
            collection_a: collection('a', 30, { lastOpened: 123 }),
            collection_b: collection('b', 10),
            collection_c: collection('c', 20),
            collection_other: { uid: 'other', name: 'Elsewhere', parentId: null, tabs: [], lastUpdated: 5 }
        });

        const payload = await gatherCollectionsForShare(FOLDER_UID);

        expect(payload.map((entry) => entry.uid)).toEqual(['b', 'c', 'a']);
        expect(payload.map((entry) => entry.data.order)).toEqual([0, 1, 2]);
        // Local-only fields must not travel to the server.
        for (const entry of payload) {
            expect(entry.data.parentId).toBeUndefined();
            expect(entry.data.lastOpened).toBeUndefined();
        }
    });

    test('persists the stamped order into the sharer\'s own local records', async () => {
        setup({
            collections_index: {
                a: { uid: 'a', name: 'Collection a', parentId: FOLDER_UID, lastUpdated: 30 },
                b: { uid: 'b', name: 'Collection b', parentId: FOLDER_UID, lastUpdated: 10 }
            },
            collection_a: collection('a', 30),
            collection_b: collection('b', 10)
        });

        await gatherCollectionsForShare(FOLDER_UID);

        const { collections_index: index, collection_a, collection_b } =
            await browser.storage.local.get(['collections_index', 'collection_a', 'collection_b']);
        expect(collection_b.order).toBe(0);
        expect(collection_a.order).toBe(1);
        expect(index.b.order).toBe(0);
        expect(index.a.order).toBe(1);
    });

    test('respects explicit existing order over the date fallback', async () => {
        // a already ordered before b: explicit order wins over lastUpdated.
        setup({
            collections_index: {
                a: { uid: 'a', name: 'Collection a', parentId: FOLDER_UID, lastUpdated: 30, order: 0 },
                b: { uid: 'b', name: 'Collection b', parentId: FOLDER_UID, lastUpdated: 10, order: 1 }
            },
            collection_a: collection('a', 30, { order: 0 }),
            collection_b: collection('b', 10, { order: 1 })
        });

        const payload = await gatherCollectionsForShare(FOLDER_UID);

        expect(payload.map((entry) => entry.uid)).toEqual(['a', 'b']);
        expect(payload.map((entry) => entry.data.order)).toEqual([0, 1]);
    });
});
