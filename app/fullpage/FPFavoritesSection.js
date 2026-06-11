import React, { useMemo } from 'react';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import FPCollectionCard from './FPCollectionCard';
import { getFavoriteCollections, buildFavoritesReorderUpdate } from '../utils/favoritesUtils';
import { dndPointerSensorOptions } from '../utils/dndShared';
import './FPFavoritesSection.css';

export const FP_FAVORITE_SORTABLE_PREFIX = 'fav:';

function SortableFavoriteCard({ id, collection, viewMode, cardProps, disableDrag }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, disabled: disableDrag });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
    };

    return (
        <div ref={setNodeRef} style={style}>
            <FPCollectionCard
                {...cardProps}
                collection={collection}
                viewMode={viewMode}
                dragAttributes={attributes}
                dragListeners={listeners}
                enableDropZone={false}
            />
        </div>
    );
}

function FPFavoritesSection({
    collections = [],
    viewMode,
    updateCollection,
    removeCollection,
    updateRemoteData,
    addCollection,
    onDataUpdate,
    onSelect,
    onCardContextMenu,
    trackedCollectionUids,
    disableDrag = false,
    search,
}) {
    const favorites = useMemo(() => getFavoriteCollections(collections), [collections]);
    const sensors = useSensors(useSensor(PointerSensor, dndPointerSensorOptions));
    const sortableIds = useMemo(
        () => favorites.map((collection) => `${FP_FAVORITE_SORTABLE_PREFIX}${collection.uid}`),
        [favorites],
    );

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = sortableIds.indexOf(active.id);
        const newIndex = sortableIds.indexOf(over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(favorites, oldIndex, newIndex);
        // Single batch write via updateRemoteData -> batchUpdateCollections
        await updateRemoteData(buildFavoritesReorderUpdate(collections, reordered));
    };

    const cardProps = {
        onSelect,
        updateCollection,
        removeCollection,
        updateRemoteData,
        addCollection,
        onDataUpdate,
        onCardContextMenu,
    };

    if (favorites.length === 0) {
        return <div className="fp-favorites-empty-hint">Star a collection to pin it here</div>;
    }

    // No wrapper element: this renders inside .fp-content-grid, and the cards
    // must be direct grid children so they get the exact same layout as the
    // main collection views (DndContext/SortableContext render no DOM).
    return (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
                items={sortableIds}
                strategy={viewMode === 'list' ? verticalListSortingStrategy : rectSortingStrategy}
            >
                {favorites.map((collection) => (
                    <SortableFavoriteCard
                        key={`fav-${collection.uid}`}
                        id={`${FP_FAVORITE_SORTABLE_PREFIX}${collection.uid}`}
                        collection={collection}
                        viewMode={viewMode}
                        disableDrag={disableDrag}
                        cardProps={{
                            ...cardProps,
                            search,
                            isAutoUpdate: trackedCollectionUids?.has(collection.uid) === true,
                        }}
                    />
                ))}
            </SortableContext>
        </DndContext>
    );
}

export default FPFavoritesSection;
