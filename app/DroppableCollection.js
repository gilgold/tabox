import React from 'react';
import { useAtomValue } from 'jotai';
import { dragSessionState } from './atoms/animationsState';

function DroppableCollection({ collection, children }) {
    const dragSession = useAtomValue(dragSessionState);
    const showDropZone = dragSession
        && dragSession.sourceCollectionUid !== collection.uid
        && dragSession.overCollectionUid === collection.uid;

    const style = {
        position: 'relative',
        ...(showDropZone ? {
            backgroundColor: 'rgba(var(--primary-color-rgb, 52, 152, 219), 0.15)',
            border: '2px dashed var(--primary-color)',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            boxShadow: '0 0 0 2px var(--primary-color)',
        } : {}),
    };

    return (
        <div
            style={style}
            data-collection-drop-zone="true"
            data-collection-uid={collection.uid}
        >
            {children}
        </div>
    );
}

export default DroppableCollection;
