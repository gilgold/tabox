import React from 'react';
import { useAtomValue } from 'jotai';
import { dragSessionState } from './atoms/animationsState';

function DroppableCollection({ collection, children, disabled = false }) {
    const dragSession = useAtomValue(dragSessionState);
    const showDropZone = dragSession
        && !disabled
        && dragSession.sourceCollectionUid !== collection.uid
        && dragSession.overCollectionUid === collection.uid;

    return (
        <div
            className={`dnd-container-target${showDropZone ? ' is-over' : ''}`}
            data-collection-drop-zone={disabled ? undefined : 'true'}
            data-collection-uid={disabled ? undefined : collection.uid}
        >
            {children}
        </div>
    );
}

export default DroppableCollection;
