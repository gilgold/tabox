import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import CollectionTile from './CollectionTile';

function SortableCollectionTile(props) {
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
            itemType: 'collection',
            collection: props.collection,
            parentId: props.collection?.parentId || null,
            isInFolder: !!props.collection?.parentId
        }
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: '20px',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
        >
            <CollectionTile
                {...props}
                activeId={props.activeId}
                dragAttributes={attributes}
                dragListeners={listeners}
            />
        </div>
    );
}

export default SortableCollectionTile; 