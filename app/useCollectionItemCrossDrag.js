import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { dragSessionState } from './atoms/animationsState';
import { applyCrossCollectionTransfer } from './utils/collectionDragUtils';

/**
 * Look through ALL layers at (x,y) to find a collection drop zone.
 * The detail panel is portaled to document.body and sits on top of the
 * collection list.  elementsFromPoint lets us see through the overlay
 * to find a target collection underneath.  When sourceCollectionUid is
 * provided, prefer a *different* collection (i.e. the cross-drag target).
 */
const readOverCollectionUid = (x, y, sourceCollectionUid) => {
    const elements = document.elementsFromPoint
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint?.(x, y)].filter(Boolean);

    // While the pointer is still inside the open detail panel, keep the drag
    // scoped to the source collection instead of peeking through to cards behind it.
    if (elements.some((element) => element?.closest?.('.collection-detail-panel'))) {
        return sourceCollectionUid || null;
    }

    let foundSource = false;

    for (const element of elements) {
        const dropZone = element.closest('[data-collection-drop-zone]');
        if (!dropZone) continue;

        const uid = dropZone.getAttribute('data-collection-uid');
        if (!uid) continue;

        if (uid !== sourceCollectionUid) {
            return uid;
        }
        foundSource = true;
    }

    return foundSource ? sourceCollectionUid : null;
};

function useCollectionItemCrossDrag({
    findCollectionByUid,
    updateCollection,
    onDataUpdate,
}) {
    const [dragSession, setDragSession] = useAtom(dragSessionState);
    const dragSessionRef = useRef(dragSession);

    useLayoutEffect(() => {
        dragSessionRef.current = dragSession;
    }, [dragSession]);

    useEffect(() => {
        if (!dragSession) {
            return undefined;
        }

        let rafId = null;

        const updatePointer = (x, y) => {
            const current = dragSessionRef.current;
            const overCollectionUid = readOverCollectionUid(x, y, current?.sourceCollectionUid);

            setDragSession((current) => {
                if (!current) {
                    return current;
                }

                const pointer = { x, y };
                if (
                    current.pointer?.x === pointer.x &&
                    current.pointer?.y === pointer.y &&
                    current.overCollectionUid === overCollectionUid
                ) {
                    return current;
                }

                return {
                    ...current,
                    pointer,
                    overCollectionUid,
                };
            });
        };

        const handleMouseMove = (event) => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }

            rafId = requestAnimationFrame(() => {
                updatePointer(event.clientX, event.clientY);
            });
        };

        const handleMouseUp = async (event) => {
            const current = dragSessionRef.current;
            if (!current) {
                return;
            }

            const sourceCollectionUid = current.sourceCollectionUid;
            const overCollectionUid = readOverCollectionUid(event.clientX, event.clientY, sourceCollectionUid);

            if (!overCollectionUid || overCollectionUid === sourceCollectionUid) {
                setDragSession(null);
                return;
            }

            const { collection: sourceCollection } = findCollectionByUid(sourceCollectionUid);
            const { collection: targetCollection } = findCollectionByUid(overCollectionUid);

            if (!sourceCollection || !targetCollection) {
                setDragSession(null);
                return;
            }

            const transfer = applyCrossCollectionTransfer(sourceCollection, targetCollection, {
                ...current,
                overCollectionUid,
                pointer: {
                    x: event.clientX,
                    y: event.clientY,
                },
            });

            if (!transfer) {
                setDragSession(null);
                return;
            }

            try {
                await updateCollection(transfer.sourceCollection, false);
                await updateCollection(transfer.targetCollection, true);

                if (onDataUpdate) {
                    await onDataUpdate();
                }
            } catch (error) {
                console.error('Error moving item between collections:', error);
            } finally {
                setDragSession(null);
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }

            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragSession, findCollectionByUid, onDataUpdate, setDragSession, updateCollection]);
}

export default useCollectionItemCrossDrag;
