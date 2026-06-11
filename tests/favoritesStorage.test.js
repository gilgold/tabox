jest.mock('../static/globals', () => {
    const store = {};
    const normalizeKeys = (keys) => (Array.isArray(keys) ? keys : [keys]);
    return {
        __store: store,
        browser: {
            storage: {
                local: {
                    get: jest.fn(async (keys) => {
                        if (keys === null || keys === undefined) return { ...store };
                        const result = {};
                        normalizeKeys(keys).forEach((key) => {
                            if (key in store) result[key] = store[key];
                        });
                        return result;
                    }),
                    set: jest.fn(async (data) => { Object.assign(store, data); }),
                    remove: jest.fn(async (keys) => {
                        normalizeKeys(keys).forEach((key) => { delete store[key]; });
                    }),
                },
            },
        },
    };
});

import { saveSingleCollection, batchUpdateCollections, STORAGE_KEYS } from '../app/utils/storageUtils';

const { __store: store } = jest.requireMock('../static/globals');

const baseCollection = (overrides = {}) => ({
    uid: 'col-1',
    name: 'Test',
    tabs: [{ uid: 't1', url: 'https://example.com' }],
    chromeGroups: [],
    color: 'blue',
    createdOn: 1000,
    lastUpdated: 2000,
    ...overrides,
});

beforeEach(() => {
    Object.keys(store).forEach((key) => { delete store[key]; });
    jest.clearAllMocks();
});

describe('saveSingleCollection favorite fields', () => {
    it('persists isFavorite and favoriteOrder to both record and index', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 2 }));
        const record = store[`${STORAGE_KEYS.COLLECTION_PREFIX}col-1`];
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(record.isFavorite).toBe(true);
        expect(record.favoriteOrder).toBe(2);
        expect(indexEntry.isFavorite).toBe(true);
        expect(indexEntry.favoriteOrder).toBe(2);
    });

    it('defaults isFavorite to false in the index when missing', async () => {
        await saveSingleCollection(baseCollection());
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(indexEntry.isFavorite).toBe(false);
        expect(indexEntry).not.toHaveProperty('favoriteOrder');
    });

    it('clears favorite state when toggled off with favoriteOrder null', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 0 }));
        await saveSingleCollection(baseCollection({ isFavorite: false, favoriteOrder: null }));
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(indexEntry.isFavorite).toBe(false);
        expect(indexEntry).not.toHaveProperty('favoriteOrder');
    });

    it('preserves favorite fields when a partial update omits them', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 3 }));
        const partial = baseCollection();
        delete partial.isFavorite;
        delete partial.favoriteOrder;
        await saveSingleCollection(partial);
        const record = store[`${STORAGE_KEYS.COLLECTION_PREFIX}col-1`];
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(record.isFavorite).toBe(true);
        expect(record.favoriteOrder).toBe(3);
        expect(indexEntry.isFavorite).toBe(true);
        expect(indexEntry.favoriteOrder).toBe(3);
    });
});

describe('batchUpdateCollections favorite fields', () => {
    it('writes favorite fields to record and index in one batch', async () => {
        await saveSingleCollection(baseCollection());
        await batchUpdateCollections([baseCollection({ isFavorite: true, favoriteOrder: 5 })]);
        const record = store[`${STORAGE_KEYS.COLLECTION_PREFIX}col-1`];
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(record.isFavorite).toBe(true);
        expect(record.favoriteOrder).toBe(5);
        expect(indexEntry.isFavorite).toBe(true);
        expect(indexEntry.favoriteOrder).toBe(5);
    });

    it('preserves favorite fields when an incoming complete object lacks them', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 1 }));
        const staleObject = baseCollection(); // tabs/chromeGroups present, no favorite fields
        delete staleObject.isFavorite;
        delete staleObject.favoriteOrder;
        await batchUpdateCollections([staleObject]);
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(indexEntry.isFavorite).toBe(true);
        expect(indexEntry.favoriteOrder).toBe(1);
    });

    it('clears favorite fields when explicitly toggled off in a batch', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 1 }));
        await batchUpdateCollections([baseCollection({ isFavorite: false, favoriteOrder: null })]);
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(indexEntry.isFavorite).toBe(false);
        expect(indexEntry).not.toHaveProperty('favoriteOrder');
    });
});
