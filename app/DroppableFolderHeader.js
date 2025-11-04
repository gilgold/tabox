import React from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';

function DroppableFolderHeader({ folder, children }) {
    const { active } = useDndContext();
    const {
        isOver,
        setNodeRef,
    } = useDroppable({
        id: `folder-${folder.uid}`,
        data: {
            type: 'folder',
            folder: folder
        }
    });

    // Only show drop zone for collections from OUTSIDE this folder
    const isDraggingCollection = active && (
        active.data.current?.itemType === 'collection' ||
        (!active.data.current?.itemType && active.data.current?.type !== 'folder')
    );
    
    // Check if the dragged collection is from this same folder
    const draggedCollectionParentId = active?.data?.current?.parentId || 
                                    (active?.data?.current?.isInFolder ? active?.data?.current?.parentId : null);
    const isDraggingFromSameFolder = draggedCollectionParentId === folder.uid;
    
    // Only show drop zone if:
    // 1. Dragging a collection AND
    // 2. Collection is NOT from this same folder (to allow internal reordering)
    const shouldShowDropZone = isOver && isDraggingCollection && !isDraggingFromSameFolder;
    
    // Enhanced debug logging for folder drops
    
    // Make drop zone more prominent for collapsed folders
    const isCollapsed = folder.collapsed;
    const dropZoneIntensity = isCollapsed ? 'high' : 'normal';

    const style = {
        backgroundColor: shouldShowDropZone ? 
            (dropZoneIntensity === 'high' ? 'rgba(79, 172, 254, 0.35)' : 'rgba(79, 172, 254, 0.15)') : 
            'transparent',
        border: shouldShowDropZone ? 
            (dropZoneIntensity === 'high' ? '3px solid #4facfe' : '2px dashed #4facfe') : 
            '3px dashed transparent',
        borderRadius: '8px',
        transition: 'all 0.2s ease',
        padding: shouldShowDropZone ? 
            (dropZoneIntensity === 'high' ? '12px' : '6px') : '0px',
        margin: shouldShowDropZone ? 
            (dropZoneIntensity === 'high' ? '8px 0' : '4px 0') : '0px',
        position: 'relative',
        minHeight: shouldShowDropZone && dropZoneIntensity === 'high' ? '60px' : 'auto',
        boxShadow: shouldShowDropZone && dropZoneIntensity === 'high' ? 
            '0 4px 12px rgba(79, 172, 254, 0.3), inset 0 0 20px rgba(79, 172, 254, 0.1)' : 'none',
        // Only apply flex styling when showing drop zone to avoid interfering with normal layout
        ...(shouldShowDropZone && {
            display: 'flex',
            alignItems: 'center',
        })
    };

    const labelStyle = {
        position: 'absolute',
        top: shouldShowDropZone ? 
            (dropZoneIntensity === 'high' ? '12px' : '8px') : '-20px',
        right: '8px',
        background: dropZoneIntensity === 'high' ? 
            'linear-gradient(45deg, #4facfe, #00c6ff)' : '#4facfe',
        color: 'white',
        padding: dropZoneIntensity === 'high' ? '6px 12px' : '4px 8px',
        borderRadius: '6px',
        fontSize: dropZoneIntensity === 'high' ? '12px' : '11px',
        fontWeight: 'bold',
        opacity: shouldShowDropZone ? 1 : 0,
        transition: 'all 0.2s ease',
        zIndex: 1000,
        pointerEvents: 'none',
        boxShadow: dropZoneIntensity === 'high' ? 
            '0 4px 8px rgba(0, 0, 0, 0.25)' : '0 2px 4px rgba(0, 0, 0, 0.2)',
        transform: dropZoneIntensity === 'high' ? 'scale(1.05)' : 'scale(1)',
        animation: shouldShowDropZone && dropZoneIntensity === 'high' ? 
            'dropIndicatorPulse 1.5s ease-in-out infinite' : 'none'
    };

    return (
        <div ref={setNodeRef} style={style}>
            {shouldShowDropZone && (
                <div style={labelStyle}>
                    {dropZoneIntensity === 'high' ? 
                        `📁 Drop into ${folder.name}` : 
                        `📁 Add to ${folder.name}`
                    }
                </div>
            )}
            {children}
        </div>
    );
}

export default DroppableFolderHeader; 