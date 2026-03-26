import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { createCollectionDropTargetId } from './utils/collectionDragUtils';
import './DropGap.css';

function DropGap({
    dropTarget,
    disabled = false,
    variant = 'tab',
    activeOverride = false,
}) {
    const id = createCollectionDropTargetId(dropTarget);
    const { isOver, setNodeRef } = useDroppable({
        id,
        disabled,
        data: { dropTarget },
    });

    const active = !disabled && (isOver || activeOverride);
    const className = [
        'drop-gap',
        variant === 'group' ? 'variant-group' : '',
        active ? 'is-over' : '',
    ].filter(Boolean).join(' ');

    return (
        <div ref={setNodeRef} className={className}>
            {active ? <div className="drop-gap-indicator" /> : null}
        </div>
    );
}

export default DropGap;
