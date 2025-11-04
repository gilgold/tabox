import React from 'react';
import { CSS } from '@dnd-kit/utilities';
import TabRow from './TabRow';
import { useSortable } from '@dnd-kit/sortable';

function SortableTabRow(props) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
        isOver,
    } = useSortable({
        id: props.tab.uid,
        disabled: props.disableDrag,
        data: {
            type: 'tab',
            tab: props.tab,
            originalGroup: props.group
        }
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : 'auto',
    };

    // Handle group drop zone styling
    const dropZoneStyle = isOver ? {
        backgroundColor: 'rgba(var(--primary-color-rgb, 52, 152, 219), 0.1)',
        borderRadius: '4px'
    } : {};

    return (
        <div 
            ref={setNodeRef} 
            style={{ ...style, ...dropZoneStyle }}
            {...attributes}
            {...listeners}
        >
            <TabRow 
                tab={props.tab}
                updateCollection={props.updateCollection}
                collection={props.collection}
                group={props.group}
                isDragging={isDragging}
            />
        </div>
    );
}

export default SortableTabRow; 