import React, { useState, useEffect, useMemo } from 'react';
import { useRecoilValue, useRecoilState } from 'recoil';
import './CollectionList.css';
import { rowToHighlightState } from './atoms/animationsState';
import {
    themeState,
    searchState,
} from './atoms/globalAppSettingsState';
import ReactTooltip from 'react-tooltip';
import { BsSearch } from 'react-icons/bs';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import SortableCollectionItem from './SortableCollectionItem';

function SearchTitle({ searchTerm }) {
    return <h2 className="search-title"><BsSearch size="14" /> &nbsp;Showing results for: <strong>{searchTerm}</strong></h2>
}

function NoCollections() {
    const themeMode = useRecoilValue(themeState);
    const search = useRecoilValue(searchState);

    return !search ? <div>
        <p id='nothing_message'>You don&apos;t have any collections!<br />
            <img className='no_contant_image' src={themeMode === 'dark' ? 'images/desert-night.png' : 'images/desert.png'} alt='desert scene' /><br />
            Add the current tabs or import a collection from file.</p>
    </div> : <div>
        <p id='nothing_message'>There are no collections that match your search.<br />
        </p>
    </div>
}

function CollectionList({
    collections,
    ...props
}) {
    const [rowToHighlight, setRowToHighlight] = useRecoilState(rowToHighlightState);
    const search = useRecoilValue(searchState);
    const [disableDrag, setDisableDrag] = useState(false);
    const [activeCollection, setActiveCollection] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor),
    );

    useEffect(() => {
        ReactTooltip.rebuild();
    }, [collections]);

    useEffect(() => {
        setDisableDrag(search !== undefined && search !== '');
    }, [search]);

    const handleDragStart = (event) => {
        const collection = collections.find((item) => item.uid === event.active.id);
        setActiveCollection(collection);
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;

        if (active.id !== over.id) {
            const oldIndex = collections.findIndex((item) => item.uid === active.id);
            const newIndex = collections.findIndex((item) => item.uid === over.id);

            const newCollections = arrayMove(collections, oldIndex, newIndex);
            props.updateRemoteData(newCollections);
        }
        setActiveCollection(null);
    };

    // Use a stable key for rendering
    const renderKey = useMemo(() => Math.random(), []);

    return (
        <section className="settings_body" key={props.key}>
            {search ? <SearchTitle searchTerm={search} /> : null}
            {collections && collections.length > 0 ? (
                <DndContext
                    key={`dnd-context-${disableDrag.toString()}`}
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                    onDragStart={handleDragStart}
                >
                    <SortableContext
                        key={`sortable-context-${disableDrag.toString()}`}
                        items={collections.map(c => c.uid)}
                        strategy={verticalListSortingStrategy}
                    >
                        {collections.map((collection, index) => (
                            <SortableCollectionItem
                                key={`${renderKey}-${collection.uid}`}
                                id={collection.uid}
                                updateRemoteData={props.updateRemoteData}
                                highlightRow={index === rowToHighlight}
                                expanded={false}
                                disableDrag={disableDrag}
                                index={index}
                                activeId={activeCollection?.uid}
                                updateCollection={props.updateCollection}
                                removeCollection={props.removeCollection}
                                collection={collection}
                                setRowToHighlight={setRowToHighlight}
                            />
                        ))}
                    </SortableContext>
                    <DragOverlay>
                        {activeCollection ? (
                        <SortableCollectionItem
                                key={`${renderKey}-${activeCollection.uid}`}
                                id={activeCollection.uid}
                                updateRemoteData={props.updateRemoteData}
                                highlightRow={-1}
                                expanded={false}
                                disableDrag={disableDrag}
                                index={-1}
                                activeId={activeCollection.uid}
                                updateCollection={props.updateCollection}
                                removeCollection={props.removeCollection}
                                collection={activeCollection}
                                setRowToHighlight={setRowToHighlight}
                            />
                        ): null}
                    </DragOverlay>
                </DndContext>
            ) : <NoCollections />}
        </section>);
}

export default CollectionList;