import React from 'react';
import { CSS } from '@dnd-kit/utilities';
import TabRow from './TabRow';
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable';

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
        },
        // Only animate layout changes when this specific item is being dragged
        animateLayoutChanges: (args) => {
            const { wasDragging, isDragging } = args;
            
            // If currently dragging this item, don't animate (it's hidden)
            if (isDragging) {
                return false;
            }
            
            // If this item was being dragged and is now being dropped, animate to new position
            if (wasDragging) {
                return true;
            }
            
            // For all other items, don't animate to prevent displacement
            return false;
        }
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        // Hide the original item when dragging (DragOverlay shows it instead)
        opacity: isDragging ? 0 : 1,
        visibility: isDragging ? 'hidden' : 'visible',
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
                search={props.search}
            />
        </div>
    );
}

export default SortableTabRow; 