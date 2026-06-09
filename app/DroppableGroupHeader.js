import React from 'react';
 
function DroppableGroupHeader({ group, children, dropProps = null, showDropZone = false }) {
    const style = {
        backgroundColor: showDropZone ? 'var(--dnd-accent-bg)' : 'transparent',
        border: showDropZone ? '2px dashed var(--dnd-accent)' : '2px dashed transparent',
        borderRadius: '6px',
        transition: 'all 0.2s ease',
        padding: showDropZone ? '6px' : '0px',
        margin: showDropZone ? '4px 0' : '0px',
        position: 'relative',
    };

    const labelStyle = {
        position: 'absolute',
        top: showDropZone ? '8px' : '-20px',
        right: '8px',
        background: 'var(--dnd-accent)',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 'bold',
        opacity: showDropZone ? 1 : 0,
        transition: 'all 0.2s ease',
        zIndex: 1000,
        pointerEvents: 'none',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
    };

    return (
        <div ref={dropProps?.setNodeRef || null} style={style}>
            {showDropZone && (
                <div style={labelStyle}>
                    Add to {group.title}
                </div>
            )}
            {children}
        </div>
    );
}

export default DroppableGroupHeader; 
