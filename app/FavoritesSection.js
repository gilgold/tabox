import React, { useMemo, useState } from 'react';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    verticalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import CollapsableSection from './CollapsableSection';
import SortableCollectionItem from './SortableCollectionItem';
import SortableCollectionTile from './SortableCollectionTile';
import CollectionTile from './CollectionTile';
import { getFavoriteCollections, buildFavoritesReorderUpdate } from './utils/favoritesUtils';
import { dndPointerSensorOptions } from './utils/dndShared';
import './FavoritesSection.css';

// Sortable IDs are namespaced because the same collection also renders (with its
// bare uid) in the main list below; dnd-kit and React both need unique IDs.
export const FAVORITE_SORTABLE_PREFIX = 'fav:';

function FavoritesSection({
    collections = [],
    viewMode,
    updateCollection,
    removeCollection,
    updateRemoteData,
    addCollection,
    onDataUpdate,
    onSelect,
}) {
    const favorites = useMemo(() => getFavoriteCollections(collections), [collections]);
    const [activeFavorite, setActiveFavorite] = useState(null);
    const sensors = useSensors(useSensor(PointerSensor, dndPointerSensorOptions));
    const sortableIds = useMemo(
        () => favorites.map((collection) => `${FAVORITE_SORTABLE_PREFIX}${collection.uid}`),
        [favorites],
    );

    const handleDragStart = (event) => {
        const uid = String(event.active.id).slice(FAVORITE_SORTABLE_PREFIX.length);
        setActiveFavorite(favorites.find((collection) => collection.uid === uid) || null);
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveFavorite(null);
        if (!over || active.id === over.id) return;
        const oldIndex = sortableIds.indexOf(active.id);
        const newIndex = sortableIds.indexOf(over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(favorites, oldIndex, newIndex);
        // Single batch write via updateRemoteData -> batchUpdateCollections
        await updateRemoteData(buildFavoritesReorderUpdate(collections, reordered));
    };

    const itemProps = (collection, index) => ({
        id: `${FAVORITE_SORTABLE_PREFIX}${collection.uid}`,
        collection,
        index,
        activeId: activeFavorite?.uid,
        updateCollection,
        removeCollection,
        updateRemoteData,
        addCollection,
        onDataUpdate,
        isInFolder: false,
        onSelect,
    });

    return (
        <CollapsableSection
            sectionKey="favoritesCollapsed"
            sectionTitle="Favorites"
            count={favorites.length}
            expandTooltip="Expand favorites section"
            collapseTooltip="Collapse favorites section"
            className="favorites-section-header"
        >
            {favorites.length === 0 ? (
                <div className="favorites-empty-hint">Star a collection to pin it here</div>
            ) : (
                <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <SortableContext
                        items={sortableIds}
                        strategy={viewMode === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
                    >
                        <div className={viewMode === 'grid' ? 'collections-section-grid' : 'collections-section-list'}>
                            {favorites.map((collection, index) => (
                                viewMode === 'grid' ? (
                                    <SortableCollectionTile key={`fav-${collection.uid}`} {...itemProps(collection, index)} />
                                ) : (
                                    <SortableCollectionItem key={`fav-${collection.uid}`} {...itemProps(collection, index)} />
                                )
                            ))}
                        </div>
                    </SortableContext>
                    <DragOverlay>
                        {activeFavorite ? (
                            viewMode === 'grid' ? (
                                <CollectionTile
                                    collection={activeFavorite}
                                    index={-1}
                                    activeId={activeFavorite.uid}
                                    updateCollection={updateCollection}
                                    removeCollection={removeCollection}
                                    updateRemoteData={updateRemoteData}
                                />
                            ) : (
                                <SortableCollectionItem
                                    id={`${FAVORITE_SORTABLE_PREFIX}${activeFavorite.uid}-overlay`}
                                    collection={activeFavorite}
                                    index={-1}
                                    activeId={activeFavorite.uid}
                                    updateCollection={updateCollection}
                                    removeCollection={removeCollection}
                                    updateRemoteData={updateRemoteData}
                                />
                            )
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}
        </CollapsableSection>
    );
}

export default FavoritesSection;
