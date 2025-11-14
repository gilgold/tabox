import React from 'react'
import { CSS } from '@dnd-kit/utilities';
import CollectionListItem from './CollectionListItem';
import { useSortable } from '@dnd-kit/sortable';

function SortableCollectionItem(props) {
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
        opacity: isDragging ? 0.6 : 1,
        borderTop: isDragging ? '1px solid var(--primary-color)' : '1px solid transparent',
        borderBottom: isDragging ? '1px solid var(--primary-color)' : '1px solid transparent',
    };

    return (
        <div ref={setNodeRef} style={style}>
                <CollectionListItem
                    {...props}
                    dragHandleProps={{ attributes, listeners }}
                />
        </div>
    );
}

export default SortableCollectionItem;