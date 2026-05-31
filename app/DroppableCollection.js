import React from 'react';
import { useAtomValue } from 'jotai';
import { dragSessionState } from './atoms/animationsState';

function DroppableCollection({ collection, children, disabled = false }) {
    const dragSession = useAtomValue(dragSessionState);
    const showDropZone = dragSession
        && !disabled
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
            data-collection-drop-zone={disabled ? undefined : 'true'}
            data-collection-uid={disabled ? undefined : collection.uid}
        >
            {children}
        </div>
    );
}

export default DroppableCollection;
