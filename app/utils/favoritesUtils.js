/**
 * Helpers for the Favorites feature.
 * Favorites are collections with isFavorite === true; their position inside the
 * Favorites section is favoriteOrder (lower = first). Missing favoriteOrder
 * sorts last (stable fallback to newest lastUpdated first).
 */

import { loadCollectionsIndex } from './storageUtils';

const normalizedFavoriteOrder = (entry) => (
    typeof entry.favoriteOrder === 'number' ? entry.favoriteOrder : null
);

export const compareFavorites = (a, b) => {
    const aOrder = normalizedFavoriteOrder(a);
    const bOrder = normalizedFavoriteOrder(b);
    if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder !== null && bOrder === null) return -1;
    if (aOrder === null && bOrder !== null) return 1;
    return (b.lastUpdated || 0) - (a.lastUpdated || 0);
};

export const getFavoriteCollections = (collections = []) => (
    collections
        .filter((collection) => collection.isFavorite === true)
        .sort(compareFavorites)
);

export const getNextFavoriteOrder = async () => {
    const index = await loadCollectionsIndex();
    const orders = Object.values(index)
        .filter((entry) => entry.isFavorite === true)
        .map((entry) => (typeof entry.favoriteOrder === 'number' ? entry.favoriteOrder : -1));
    return orders.length > 0 ? Math.max(...orders) + 1 : 0;
};

export const buildFavoritesReorderUpdate = (collections, reorderedFavorites) => {
    const orderByUid = new Map(reorderedFavorites.map((collection, index) => [collection.uid, index]));
    return collections.map((collection) => (
        orderByUid.has(collection.uid)
            ? { ...collection, favoriteOrder: orderByUid.get(collection.uid) }
            : collection
    ));
};
