import { useState, useRef, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import {
    pointerWithin,
    closestCorners,
    PointerSensor,
    useSensor,
    useSensors,
    MeasuringStrategy,
} from '@dnd-kit/core';
import { dndPointerSensorOptions } from '../utils/dndShared';
import { findSidebarDropTarget } from './sidebarDropTargets';
import {
    applyCollectionDropOperation,
    collectionDropKinds,
    collectionDropSides,
    getAffectedCollectionParentIds,
    getCollectionTargetSide,
    normalizeCollectionParentId,
    resolveCollectionDropOperation,
    resolveCollectionDropTarget,
} from '../utils/collectionSectionDragEngine';
import { resolveGroupedSectionTarget } from './groupedSectionHitTest';
import { noPermissionOpenState } from '../atoms/sharedFoldersState';
import { guardFolderEdit } from '../utils/sharedFolderUtils';

const getDragOverlayCenter = () => {
    if (typeof document === 'undefined') {
        return null;
    }

    const overlayElement = document.querySelector('[data-fp-drag-overlay="true"]');
    if (!overlayElement) {
        return null;
    }

    const rect = overlayElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }

    return {
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
    };
};

const getActualPointerCoordinates = (event) => {
    const clientX = event?.activatorEvent?.clientX;
    const clientY = event?.activatorEvent?.clientY;
    const deltaX = event?.delta?.x;
    const deltaY = event?.delta?.y;

    if (
        typeof clientX === 'number' &&
        typeof clientY === 'number' &&
        typeof deltaX === 'number' &&
        typeof deltaY === 'number'
    ) {
        return {
            x: clientX + deltaX,
            y: clientY + deltaY,
        };
    }

    const translatedRect = event?.active?.rect?.current?.translated;
    if (
        translatedRect &&
        typeof translatedRect.left === 'number' &&
        typeof translatedRect.top === 'number' &&
        typeof translatedRect.width === 'number' &&
        typeof translatedRect.height === 'number'
    ) {
        return {
            x: translatedRect.left + (translatedRect.width / 2),
            y: translatedRect.top + (translatedRect.height / 2),
        };
    }

    return null;
};

const getPointerCoordinates = (event) => {
    const overlayCenter = getDragOverlayCenter();
    if (overlayCenter) {
        return overlayCenter;
    }

    return getActualPointerCoordinates(event);
};

export function useFPCollectionDnd({
    sourceCollections,
    displayCollections,
    folders,
    folderUidSet,
    viewMode,
    sortByField,
    sortOrder,
    dragSession,
    hasSearchQuery,
    shouldRenderGroupedAllCollections,
    canReorderFlatCollections,
    groupedSectionCollectionsMap,
    persistCollectionChanges,
    setHighlightedCollectionUid,
    setDraggingCollection,
    triggerFolderLightningEffect,
}) {
    const [activeCollection, setActiveCollection] = useState(null);
    const [previewTarget, setPreviewTarget] = useState(null);
    const previewTargetRef = useRef(null);
    const lastMeaningfulDropTargetRef = useRef(null);
    const activeDragRectRef = useRef(null);
    const lastSidebarHoverRef = useRef(null);
    const setNoPermissionOpen = useSetAtom(noPermissionOpenState);

    // Permission guard: block a drop when any affected folder (source or
    // target) is a read-only share.
    const guardAffectedFolders = (affectedParentIds) => {
        for (const parentId of affectedParentIds) {
            if (!parentId) continue;
            const folder = folders.find((f) => f.uid === parentId);
            if (!guardFolderEdit(folder, () => setNoPermissionOpen(true))) {
                return false;
            }
        }
        return true;
    };

    // DnD
    const sensors = useSensors(
        useSensor(PointerSensor, dndPointerSensorOptions)
    );

    const customCollisionDetection = useCallback((args) => {
        if (dragSession) {
            return [];
        }

        const activeId = args.active?.id;
        const pointerCollisions = pointerWithin(args);
        const isCollectionCollision = (collision) => {
            const collisionId = typeof collision.id === 'string' && collision.id.startsWith('collection-drop-')
                ? collision.id.slice('collection-drop-'.length)
                : collision.id;
            return collisionId !== activeId && displayCollections.some((collection) => collection.uid === collisionId);
        };
        const isSectionCollision = (collision) => {
            const dragType = collision?.data?.droppableContainer?.data?.current?.dragType;
            return dragType === collectionDropKinds.sectionStart ||
                dragType === collectionDropKinds.sectionEnd ||
                dragType === collectionDropKinds.sectionEmpty;
        };
        const getCollisionParentId = (collision) => {
            const dragType = collision?.data?.droppableContainer?.data?.current?.dragType;
            const dataParentId = collision?.data?.droppableContainer?.data?.current?.parentId;

            if (
                dragType === collectionDropKinds.sectionStart ||
                dragType === collectionDropKinds.sectionEnd ||
                dragType === collectionDropKinds.sectionEmpty
            ) {
                return dataParentId || null;
            }

            const collisionId = typeof collision?.id === 'string' && collision.id.startsWith('collection-drop-')
                ? collision.id.slice('collection-drop-'.length)
                : collision?.id;
            const collection = displayCollections.find((entry) => entry.uid === collisionId);
            return collection ? normalizeCollectionParentId(collection, folderUidSet) : undefined;
        };

        const pointerCollectionTargets = pointerCollisions.filter(isCollectionCollision);
        const pointerSectionTargets = pointerCollisions.filter(isSectionCollision);

        if (shouldRenderGroupedAllCollections) {
            if (pointerCollectionTargets.length > 0) {
                return pointerCollectionTargets;
            }

            if (viewMode === 'grid') {
                if (pointerSectionTargets.length > 0) {
                    const hoveredParentId = getCollisionParentId(pointerSectionTargets[0]);
                    const cornerCollectionTargets = closestCorners(args).filter((collision) => (
                        isCollectionCollision(collision) && getCollisionParentId(collision) === hoveredParentId
                    ));

                    if (cornerCollectionTargets.length > 0) {
                        return cornerCollectionTargets;
                    }

                    return pointerSectionTargets;
                }

                return [];
            }

            if (pointerSectionTargets.length > 0) {
                return pointerSectionTargets;
            }

            // List mode fallback: widen with corner collisions only when the
            // pointer found nothing.
            const cornerCollisions = closestCorners(args);
            const uniqueCollisions = [...pointerCollisions, ...cornerCollisions].filter((collision, index, array) => (
                index === array.findIndex((entry) => entry.id === collision.id)
            ));
            const collectionTargets = uniqueCollisions.filter(isCollectionCollision);

            if (collectionTargets.length > 0) {
                return collectionTargets;
            }

            const sectionTargets = uniqueCollisions.filter(isSectionCollision);

            if (sectionTargets.length > 0) {
                return sectionTargets;
            }

            return [];
        }

        if (canReorderFlatCollections) {
            const cornerCollisions = closestCorners(args);
            const uniqueCollisions = [...pointerCollisions, ...cornerCollisions].filter((collision, index, array) => (
                index === array.findIndex((entry) => entry.id === collision.id)
            ));
            const collectionTargets = uniqueCollisions.filter(isCollectionCollision);

            if (collectionTargets.length > 0) {
                return collectionTargets;
            }

            return [];
        }

        return [];
    }, [
        canReorderFlatCollections,
        dragSession,
        displayCollections,
        folderUidSet,
        shouldRenderGroupedAllCollections,
        viewMode,
    ]);

    const measuring = {
        droppable: { strategy: MeasuringStrategy.Always },
        dragOverlay: { strategy: MeasuringStrategy.Always },
    };

    const resetDragState = useCallback(() => {
        setActiveCollection(null);
        setPreviewTarget(null);
        previewTargetRef.current = null;
        lastMeaningfulDropTargetRef.current = null;
        setDraggingCollection(null);
        activeDragRectRef.current = null;
        lastSidebarHoverRef.current = null;
    }, [setDraggingCollection]);

    const handleDragStart = (event) => {
        if (dragSession || hasSearchQuery) {
            resetDragState();
            return;
        }

        const col = sourceCollections.find(c => c.uid === event.active.id);
        if (col) {
            setActiveCollection(col);
            setDraggingCollection({ collection: col, overSidebarTarget: null });
        }
        activeDragRectRef.current = null;
        setPreviewTarget(null);
        previewTargetRef.current = null;
        lastMeaningfulDropTargetRef.current = null;

        // Measure the original card so the overlay matches its grid size.
        const activeId = String(event.active.id);
        const escapedId = window.CSS?.escape ? window.CSS.escape(activeId) : activeId.replace(/"/g, '\\"');
        const sourceEl = document.querySelector(`[data-sortable-collection-id="${escapedId}"]`);
        if (sourceEl) {
            const r = sourceEl.getBoundingClientRect();
            activeDragRectRef.current = { width: r.width, height: r.height };
        } else {
            const initial = event.active?.rect?.current?.initial;
            if (initial && initial.width > 0) {
                activeDragRectRef.current = { width: initial.width, height: initial.height };
            }
        }
    };

    const getCollectionTargetRect = (collectionId) => {
        if (!collectionId || typeof document === 'undefined') {
            return null;
        }

        const escapedId = window.CSS?.escape
            ? window.CSS.escape(collectionId)
            : collectionId.replace(/"/g, '\\"');
        const element = document.querySelector(`[data-sortable-collection-id="${escapedId}"]`);

        return element?.getBoundingClientRect() || null;
    };

    const handleDragOver = (event) => {
        if (dragSession || hasSearchQuery) {
            resetDragState();
            return;
        }

        const baseTarget = resolveCollectionDropTarget({
            over: event.over,
            collections: displayCollections,
            folderUidSet,
        });
        const point = getPointerCoordinates(event);
        const pointerPoint = getActualPointerCoordinates(event) || point;
        const groupedSectionTarget = shouldRenderGroupedAllCollections && pointerPoint
            ? resolveGroupedSectionTarget({
                point: pointerPoint,
                viewMode,
                activeId: activeCollection?.uid,
                // Don't let a grid card hit override a base target that is
                // already collection-kind.
                allowGridCollectionTarget: baseTarget?.kind !== collectionDropKinds.collection,
            })
            : null;
        let nextTarget = groupedSectionTarget || baseTarget;

        if (
            shouldRenderGroupedAllCollections &&
            viewMode === 'grid' &&
            nextTarget &&
            (
                nextTarget.kind === collectionDropKinds.sectionStart ||
                nextTarget.kind === collectionDropKinds.sectionEnd
            )
        ) {
            const destinationCollections = groupedSectionCollectionsMap.get(nextTarget.parentId) || [];
            if (destinationCollections.length > 0) {
                nextTarget = {
                    kind: collectionDropKinds.collection,
                    parentId: nextTarget.parentId,
                    collectionId: nextTarget.kind === collectionDropKinds.sectionStart
                        ? destinationCollections[0].uid
                        : destinationCollections[destinationCollections.length - 1].uid,
                    side: nextTarget.kind === collectionDropKinds.sectionStart
                        ? collectionDropSides.before
                        : collectionDropSides.after,
                };
            }
        }

        if (!nextTarget || !activeCollection) {
            setPreviewTarget(null);
            previewTargetRef.current = null;
            return;
        }

        if (nextTarget.kind === collectionDropKinds.collection) {
            if (nextTarget.collectionId === activeCollection.uid) {
                return;
            }

            const rect = getCollectionTargetRect(nextTarget.collectionId);
            const side = nextTarget.side || getCollectionTargetSide({
                viewMode,
                point: pointerPoint || point,
                rect,
            });

            const resolvedTarget = {
                ...nextTarget,
                side,
            };

            const collectionOperation = resolveCollectionDropOperation({
                collections: sourceCollections,
                folders,
                activeId: activeCollection.uid,
                target: resolvedTarget,
                viewMode,
                sortBy: sortByField,
                sortOrder,
            });

            if (!collectionOperation) {
                setPreviewTarget(null);
                previewTargetRef.current = null;
                lastMeaningfulDropTargetRef.current = null;
                return;
            }

            setPreviewTarget(resolvedTarget);
            previewTargetRef.current = resolvedTarget;
            lastMeaningfulDropTargetRef.current = resolvedTarget;
            return;
        }

        const sectionOperation = resolveCollectionDropOperation({
            collections: sourceCollections,
            folders,
            activeId: activeCollection.uid,
            target: nextTarget,
            viewMode,
            sortBy: sortByField,
            sortOrder,
        });

        if (!sectionOperation) {
            setPreviewTarget(null);
            previewTargetRef.current = null;
            lastMeaningfulDropTargetRef.current = null;
            return;
        }

        setPreviewTarget(nextTarget);
        previewTargetRef.current = nextTarget;
        lastMeaningfulDropTargetRef.current = nextTarget;
    };

    const handleDragMove = (event) => {
        if (!activeCollection) {
            return;
        }

        const point = getActualPointerCoordinates(event);
        const sidebarTarget = point ? findSidebarDropTarget(point.x, point.y) : null;

        if (lastSidebarHoverRef.current === sidebarTarget) {
            return;
        }

        lastSidebarHoverRef.current = sidebarTarget;
        setDraggingCollection({ collection: activeCollection, overSidebarTarget: sidebarTarget });
    };

    const handleDragEnd = async (event) => {
        if (dragSession || hasSearchQuery) {
            resetDragState();
            return;
        }

        const { active } = event;
        const draggedCollection = sourceCollections.find(collection => collection.uid === active.id);
        const draggedParentId = draggedCollection
            ? normalizeCollectionParentId(draggedCollection, folderUidSet)
            : null;

        // Check for cross-context sidebar drop using the actual pointer position
        // at drop time. Computed from dnd-kit's activatorEvent + accumulated delta.
        const finalX = event.activatorEvent.clientX + event.delta.x;
        const finalY = event.activatorEvent.clientY + event.delta.y;
        const sidebarTarget = findSidebarDropTarget(finalX, finalY);

        if (sidebarTarget && draggedCollection) {
            const targetParentId = sidebarTarget === 'no-folder' ? null : sidebarTarget;

            if (targetParentId !== draggedParentId) {
                const sidebarOperation = resolveCollectionDropOperation({
                    collections: sourceCollections,
                    folders,
                    activeId: active.id,
                    target: {
                        kind: collectionDropKinds.sectionEnd,
                        parentId: targetParentId,
                    },
                    viewMode,
                    sortBy: sortByField,
                    sortOrder,
                });
                const nextCollections = applyCollectionDropOperation({
                    collections: sourceCollections,
                    folders,
                    operation: sidebarOperation,
                    sortBy: sortByField,
                    sortOrder,
                });

                if (nextCollections) {
                    const affectedParentIds = getAffectedCollectionParentIds(sidebarOperation);
                    if (!guardAffectedFolders(affectedParentIds)) {
                        resetDragState();
                        return;
                    }
                    await persistCollectionChanges(nextCollections, affectedParentIds);
                    setHighlightedCollectionUid(draggedCollection.uid);
                    if (targetParentId && triggerFolderLightningEffect) {
                        triggerFolderLightningEffect(targetParentId);
                    }
                }
            }

            resetDragState();
            return;
        }

        const finalPreviewTarget = previewTargetRef.current || lastMeaningfulDropTargetRef.current;

        if (!finalPreviewTarget || !draggedCollection) {
            resetDragState();
            return;
        }

        const operation = resolveCollectionDropOperation({
            collections: sourceCollections,
            folders,
            activeId: active.id,
            target: finalPreviewTarget,
            viewMode,
            sortBy: sortByField,
            sortOrder,
        });
        const nextCollections = applyCollectionDropOperation({
            collections: sourceCollections,
            folders,
            operation,
            sortBy: sortByField,
            sortOrder,
        });

        if (nextCollections) {
            const affectedParentIds = getAffectedCollectionParentIds(operation);
            if (!guardAffectedFolders(affectedParentIds)) {
                resetDragState();
                return;
            }
            await persistCollectionChanges(nextCollections, affectedParentIds);
            setHighlightedCollectionUid(draggedCollection.uid);
            if (
                finalPreviewTarget.parentId &&
                finalPreviewTarget.parentId !== draggedParentId &&
                triggerFolderLightningEffect
            ) {
                triggerFolderLightningEffect(finalPreviewTarget.parentId);
            }
        }

        resetDragState();
    };

    return {
        sensors,
        measuring,
        customCollisionDetection,
        activeCollection,
        previewTarget,
        activeDragRectRef,
        handleDragStart,
        handleDragMove,
        handleDragOver,
        handleDragEnd,
        resetDragState,
    };
}
