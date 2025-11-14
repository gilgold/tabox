import React from 'react';
import { useDroppable } from '@dnd-kit/core';

function DroppableGroupHeader({ group, children }) {
    const {
        isOver,
        setNodeRef,
    } = useDroppable({
        id: `group-${group.uid}`,
        data: {
            type: 'group',
            group: group
        }
    });

    const style = {
        backgroundColor: isOver ? 'rgba(var(--primary-color-rgb, 52, 152, 219), 0.15)' : 'transparent',
        border: isOver ? '2px dashed var(--primary-color)' : '2px dashed transparent',
        borderRadius: '6px',
        transition: 'all 0.2s ease',
        padding: isOver ? '6px' : '0px',
        margin: isOver ? '4px 0' : '0px',
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
            {isOver && (
                <div style={labelStyle}>
                    📁 Add to {group.title}
                </div>
            )}
            {children}
        </div>
    );
}

export default DroppableGroupHeader; 