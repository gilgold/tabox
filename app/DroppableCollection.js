import React, { useState, useEffect, useRef } from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import { useRecoilValue } from 'recoil';
import { draggingTabState, draggingGroupState } from './atoms/animationsState';

function DroppableCollection({ collection, children }) {
    const draggingTab = useRecoilValue(draggingTabState);
    const draggingGroup = useRecoilValue(draggingGroupState);
    const isDraggingTab = draggingTab !== null;
    const isDraggingGroup = draggingGroup !== null;
    const isDraggingItem = isDraggingTab || isDraggingGroup;
    const { active } = useDndContext();
    const [isOverManually, setIsOverManually] = useState(false);
    const dropZoneRef = useRef(null);
    
    const {
        isOver,
        setNodeRef,
    } = useDroppable({
        id: `collection-drop-${collection.uid}`,
        data: {
            type: 'collection-drop',
            collection: collection
        }
    });

    // Manual detection for cross-context tab/group dragging
    useEffect(() => {
        if (!isDraggingItem || !dropZoneRef.current) {
            setIsOverManually(false);
            return;
        }

        const handleMouseMove = (e) => {
            if (dropZoneRef.current) {
                const rect = dropZoneRef.current.getBoundingClientRect();
                const isOverElement = (
                    e.clientX >= rect.left &&
                    e.clientX <= rect.right &&
                    e.clientY >= rect.top &&
                    e.clientY <= rect.bottom
                );
                setIsOverManually(isOverElement);
            }
        };

        const handleMouseUp = () => {
            setIsOverManually(false);
        };

        if (isDraggingItem) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingItem]);

    // Combine both detection methods: useDroppable (for same context) or manual (for cross-context tabs/groups)
    const sourceCollectionUid = draggingTab?.sourceCollection?.uid || draggingGroup?.sourceCollection?.uid;
    const showDropZone = isOver || (isDraggingItem && isOverManually && sourceCollectionUid !== collection.uid);

    const style = {
        position: 'relative',
        ...(showDropZone ? {
            backgroundColor: 'rgba(var(--primary-color-rgb, 52, 152, 219), 0.15)',
            border: '2px dashed var(--primary-color)',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            boxShadow: '0 0 0 2px var(--primary-color)',
        } : {})
    };

    return (
        <div 
            ref={(node) => {
                setNodeRef(node);
                dropZoneRef.current = node;
            }} 
            style={style}
            data-collection-drop-zone="true"
            data-collection-uid={collection.uid}
        >
            {children}
        </div>
    );
}

export default DroppableCollection;
