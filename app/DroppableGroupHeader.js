import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useRecoilValue } from 'recoil';
import { draggingGroupState } from './atoms/animationsState';

function DroppableGroupHeader({ group, children }) {
    const draggingGroup = useRecoilValue(draggingGroupState);
    const isDraggingGroup = !!draggingGroup;
    
    const {
        isOver,
        setNodeRef,
    } = useDroppable({
        id: `group-${group.uid}`,
        data: {
            type: 'group',
            group: group
        },
        disabled: isDraggingGroup, // Disable drop zone when dragging a group
    });

    // Only show drop zone if not dragging a group (groups cannot be nested)
    const showDropZone = isOver && !isDraggingGroup;
    
    const style = {
        backgroundColor: showDropZone ? 'rgba(var(--primary-color-rgb, 52, 152, 219), 0.15)' : 'transparent',
        border: showDropZone ? '2px dashed var(--primary-color)' : '2px dashed transparent',
        borderRadius: '6px',
        transition: 'all 0.2s ease',
        padding: showDropZone ? '6px' : '0px',
        margin: showDropZone ? '4px 0' : '0px',
        position: 'relative',
    };

    const labelStyle = {
        position: 'absolute',
        top: isOver ? '8px' : '-20px',
        right: '8px',
        background: 'var(--primary-color)',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 'bold',
        opacity: isOver ? 1 : 0,
        transition: 'all 0.2s ease',
        zIndex: 1000,
        pointerEvents: 'none',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
    };

    return (
        <div ref={setNodeRef} style={style}>
            {showDropZone && (
                <div style={labelStyle}>
                    📁 Add to {group.title}
                </div>
            )}
            {children}
        </div>
    );
}

export default DroppableGroupHeader; 