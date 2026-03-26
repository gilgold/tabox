import React from 'react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import TabRow from './TabRow';

function SortableTabRow(props) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: props.tab.uid,
        disabled: props.disableDrag,
        data: {
            itemType: 'tab',
            tabId: props.tab.uid,
            groupUid: props.group?.uid || null,
            pinned: !!props.tab.pinned,
        },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.25 : 1,
        position: 'relative',
    };

    return (
        <div ref={setNodeRef} style={style} className="collection-draggable-tab">
            <TabRow
                tab={props.tab}
                updateCollection={props.updateCollection}
                collection={props.collection}
                group={props.group}
                isDragging={isDragging}
                search={props.search}
                dragHandleProps={props.disableDrag ? {} : { ...attributes, ...listeners }}
            />
        </div>
    );
}

export default SortableTabRow;
