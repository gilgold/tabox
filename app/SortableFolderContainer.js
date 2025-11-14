import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import FolderContainer from './FolderContainer';

function SortableFolderContainer(props) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ 
        id: props.id,
        disabled: props.disableDrag,
        data: {
            type: 'folder',
            folder: props.folder
        }
    });



    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        borderTop: isDragging ? '1px solid var(--primary-color)' : '1px solid transparent',
        borderBottom: isDragging ? '1px solid var(--primary-color)' : '1px solid transparent',
        zIndex: isDragging ? 1000 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="sortable-folder-wrapper"
        >
            <FolderContainer
                {...props}
                dragAttributes={attributes}
                dragListeners={listeners}
                isDragging={isDragging}
                viewMode={props.viewMode}
            />
        </div>
    );
}

export default SortableFolderContainer; 