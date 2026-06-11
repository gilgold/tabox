import React, { useEffect, useMemo, useState } from 'react';
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
import { FaStar } from 'react-icons/fa';
import { MdExpandMore, MdExpandLess } from 'react-icons/md';
import FPCollectionCard from './FPCollectionCard';
import { getFavoriteCollections, buildFavoritesReorderUpdate } from '../utils/favoritesUtils';
import { dndPointerSensorOptions } from '../utils/dndShared';
import { browser } from '../../static/globals';
import './FPFavoritesSection.css';

export const FP_FAVORITE_SORTABLE_PREFIX = 'fav:';

function SortableFavoriteCard({ id, collection, viewMode, cardProps }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

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
}) {
    const favorites = useMemo(() => getFavoriteCollections(collections), [collections]);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const sensors = useSensors(useSensor(PointerSensor, dndPointerSensorOptions));
    const sortableIds = useMemo(
        () => favorites.map((collection) => `${FP_FAVORITE_SORTABLE_PREFIX}${collection.uid}`),
        [favorites],
    );

    useEffect(() => {
        let mounted = true;
        browser.storage.local.get(['fpFavoritesCollapsed'])
            .then((result) => {
                if (mounted) setIsCollapsed(result.fpFavoritesCollapsed || false);
            })
            .catch(() => {});
        return () => { mounted = false; };
    }, []);

    const toggleCollapsed = () => {
        const next = !isCollapsed;
        setIsCollapsed(next);
        browser.storage.local.set({ fpFavoritesCollapsed: next }).catch(() => {});
    };

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

    return (
        <section className="fp-favorites-section">
            <div
                className="fp-favorites-header"
                onClick={toggleCollapsed}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleCollapsed();
                    }
                }}
                aria-expanded={!isCollapsed}
                data-tooltip-id="main-tooltip"
                data-tooltip-content={isCollapsed ? 'Expand favorites' : 'Collapse favorites'}
            >
                <FaStar size={13} className="fp-favorites-header-star" />
                <span className="fp-favorites-title">Favorites</span>
                <span className="fp-favorites-count">({favorites.length})</span>
                {isCollapsed ? <MdExpandMore size={18} /> : <MdExpandLess size={18} />}
            </div>
            {!isCollapsed && (
                favorites.length === 0 ? (
                    <div className="fp-favorites-empty-hint">Star a collection to pin it here</div>
                ) : (
                    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                        <SortableContext
                            items={sortableIds}
                            strategy={viewMode === 'list' ? verticalListSortingStrategy : rectSortingStrategy}
                        >
                            <div className={`fp-favorites-items${viewMode === 'list' ? ' fp-content-list-mode' : ''}`}>
                                {favorites.map((collection) => (
                                    <SortableFavoriteCard
                                        key={`fav-${collection.uid}`}
                                        id={`${FP_FAVORITE_SORTABLE_PREFIX}${collection.uid}`}
                                        collection={collection}
                                        viewMode={viewMode}
                                        cardProps={{
                                            ...cardProps,
                                            isAutoUpdate: trackedCollectionUids?.has(collection.uid) === true,
                                        }}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )
            )}
        </section>
    );
}

export default FPFavoritesSection;
