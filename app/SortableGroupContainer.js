import React from 'react';
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import GroupContainer from './GroupContainer';

function SortableGroupContainer(props) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: props.group.uid,
        disabled: props.disableDrag,
        data: {
            type: 'group',
            group: props.group,
            tabs: props.tabs,
            sourceCollection: props.collection
        },
        // Only animate layout changes when this specific item is being dragged
        // This prevents other groups from being displaced during drag
        animateLayoutChanges: (args) => {
            const { isSorting, wasDragging, isDragging } = args;
            
            // If currently dragging this item, don't animate (it's hidden)
            if (isDragging) {
                return false;
            }
            
            // If this item was being dragged and is now being dropped, animate to new position
            if (wasDragging) {
                return true;
            }
            
            // For all other items (not currently dragging, not previously dragged),
            // don't animate to prevent displacement
            return false;
        }
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        // Hide the original item when dragging (DragOverlay shows it instead)
        // This prevents visual displacement of other groups
        opacity: isDragging ? 0 : 1,
        visibility: isDragging ? 'hidden' : 'visible',
        zIndex: isDragging ? 1000 : 'auto',
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style}
        >
            <GroupContainer
                {...props}
                isDragging={isDragging}
                dragAttributes={attributes}
                dragListeners={listeners}
            />
        </div>
    );
}

export default SortableGroupContainer;
