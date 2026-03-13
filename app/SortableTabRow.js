import React, { useRef, useState, useEffect, useCallback } from 'react';
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
        active,
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

    const elementRef = useRef(null);
    const [dropPosition, setDropPosition] = useState(null); // 'top' or 'bottom'

    // Merge refs: one for dnd-kit, one for our element measurement
    const mergedRef = useCallback((node) => {
        elementRef.current = node;
        setNodeRef(node);
    }, [setNodeRef]);

    // Track mouse position relative to element to determine drop indicator position
    useEffect(() => {
        if (!isOver || isDragging || !elementRef.current) {
            setDropPosition(null);
            return;
        }

        const element = elementRef.current;

        const handlePointerMove = (e) => {
            const rect = element.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            setDropPosition(e.clientY < midY ? 'top' : 'bottom');
        };

        // Use document-level listener since the pointer may be captured by dnd-kit
        document.addEventListener('pointermove', handlePointerMove);
        // Also set initial position
        document.addEventListener('mousemove', handlePointerMove);

        return () => {
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('mousemove', handlePointerMove);
            setDropPosition(null);
        };
    }, [isOver, isDragging]);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        // Hide the original item when dragging (DragOverlay shows it instead)
        opacity: isDragging ? 0 : 1,
        visibility: isDragging ? 'hidden' : 'visible',
        zIndex: isDragging ? 1000 : 'auto',
    };

    const showIndicator = isOver && !isDragging && dropPosition && active;

    return (
        <div
            ref={mergedRef}
            style={style}
            className="sortable-tab-row-wrapper"
            {...attributes}
            {...listeners}
        >
            {showIndicator && dropPosition === 'top' && (
                <div className="tab-drop-indicator tab-drop-indicator-top" />
            )}
            <TabRow
                tab={props.tab}
                updateCollection={props.updateCollection}
                collection={props.collection}
                group={props.group}
                isDragging={isDragging}
                search={props.search}
            />
            {showIndicator && dropPosition === 'bottom' && (
                <div className="tab-drop-indicator tab-drop-indicator-bottom" />
            )}
        </div>
    );
}

export default SortableTabRow;
