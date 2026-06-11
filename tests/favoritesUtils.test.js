import {
    getFavoriteCollections,
    getNextFavoriteOrder,
    buildFavoritesReorderUpdate,
} from '../app/utils/favoritesUtils';

jest.mock('../app/utils/storageUtils', () => ({
    loadCollectionsIndex: jest.fn(),
}));

const { loadCollectionsIndex } = jest.requireMock('../app/utils/storageUtils');

describe('getFavoriteCollections', () => {
    it('returns only favorited collections sorted by favoriteOrder', () => {
        const collections = [
            { uid: 'a', isFavorite: true, favoriteOrder: 2 },
            { uid: 'b', isFavorite: false },
            { uid: 'c', isFavorite: true, favoriteOrder: 0 },
            { uid: 'd' },
            { uid: 'e', isFavorite: true, favoriteOrder: 1 },
        ];
        expect(getFavoriteCollections(collections).map(c => c.uid)).toEqual(['c', 'e', 'a']);
    });

    it('sorts favorites with missing favoriteOrder last, newest lastUpdated first among them', () => {
        const collections = [
            { uid: 'a', isFavorite: true, lastUpdated: 100 },
            { uid: 'b', isFavorite: true, favoriteOrder: 0 },
            { uid: 'c', isFavorite: true, lastUpdated: 200 },
        ];
        expect(getFavoriteCollections(collections).map(c => c.uid)).toEqual(['b', 'c', 'a']);
    });

    it('returns empty array for undefined input', () => {
        expect(getFavoriteCollections(undefined)).toEqual([]);
    });
});

describe('getNextFavoriteOrder', () => {
    it('returns max favoriteOrder + 1 across favorited index entries', async () => {
        loadCollectionsIndex.mockResolvedValue({
            a: { isFavorite: true, favoriteOrder: 3 },
            b: { isFavorite: true, favoriteOrder: 7 },
            c: { isFavorite: false, favoriteOrder: 99 },
        });
        await expect(getNextFavoriteOrder()).resolves.toBe(8);
    });

    it('returns 0 when there are no favorites', async () => {
        loadCollectionsIndex.mockResolvedValue({ a: { isFavorite: false } });
        await expect(getNextFavoriteOrder()).resolves.toBe(0);
    });

    it('treats favorites with missing favoriteOrder as order -1', async () => {
        loadCollectionsIndex.mockResolvedValue({ a: { isFavorite: true } });
        await expect(getNextFavoriteOrder()).resolves.toBe(0);
    });
});

describe('buildFavoritesReorderUpdate', () => {
    it('stamps sequential favoriteOrder onto reordered favorites, leaves others untouched', () => {
        const all = [
            { uid: 'a', isFavorite: true, favoriteOrder: 0 },
            { uid: 'b', isFavorite: false },
            { uid: 'c', isFavorite: true, favoriteOrder: 1 },
        ];
        const reordered = [all[2], all[0]]; // c first, a second
        const result = buildFavoritesReorderUpdate(all, reordered);
        expect(result.find(c => c.uid === 'c').favoriteOrder).toBe(0);
        expect(result.find(c => c.uid === 'a').favoriteOrder).toBe(1);
        expect(result.find(c => c.uid === 'b')).toBe(all[1]); // untouched reference
    });
});
