import React from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';

function DroppableFolderContent({ folder, children }) {
    const { active } = useDndContext();
    const {
        isOver,
        setNodeRef,
    } = useDroppable({
        id: `folder-content-${folder.uid}`,
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
    
    
    const isExpanded = !folder.collapsed;
    
    // Only show drop zone if:
    // 1. Dragging a collection AND
    // 2. Folder is expanded AND  
    // 3. Collection is NOT from this same folder (to allow internal reordering)
    const shouldShowDropZone = isOver && isDraggingCollection && isExpanded && !isDraggingFromSameFolder;

    const style = {
        backgroundColor: shouldShowDropZone ? 'rgba(79, 172, 254, 0.08)' : 'transparent',
        border: shouldShowDropZone ? '2px dashed #4facfe' : '2px dashed transparent',
        borderRadius: '8px',
        transition: 'all 0.2s ease',
        padding: shouldShowDropZone ? '4px' : '0px',
        margin: shouldShowDropZone ? '2px' : '0px',
        position: 'relative',
        minHeight: '24px', // Ensure there's always something to drop on
    };

    const labelStyle = {
        position: 'absolute',
        top: shouldShowDropZone ? '8px' : '-20px',
        right: '8px',
        background: '#4facfe',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 'bold',
        opacity: shouldShowDropZone ? 1 : 0,
        transition: 'all 0.2s ease',
        zIndex: 1000,
        pointerEvents: 'none',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
    };

    return (
        <div ref={setNodeRef} style={style}>
            {shouldShowDropZone && (
                <div style={labelStyle}>
                    📁 Add to {folder.name}
                </div>
            )}
            {children}
        </div>
    );
}

export default DroppableFolderContent; 