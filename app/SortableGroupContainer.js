import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import GroupContainer from './GroupContainer';
import {
    collectionDropTargetTypes,
    createCollectionDropTargetId,
} from './utils/collectionDragUtils';

function SortableGroupContainer(props) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        isDragging,
    } = useDraggable({
        id: props.group.uid,
        disabled: props.disableDrag,
        data: {
            itemType: 'group',
            groupUid: props.group.uid,
        },
    });

    const headerTarget = {
        type: collectionDropTargetTypes.GROUP_APPEND,
        groupUid: props.group.uid,
        surface: 'header',
    };
    const bodyTarget = {
        type: collectionDropTargetTypes.GROUP_APPEND,
        groupUid: props.group.uid,
        surface: 'body',
    };

    const headerDrop = useDroppable({
        id: createCollectionDropTargetId(headerTarget),
        disabled: props.dragSession?.kind !== 'tab',
        data: {
            dropTarget: headerTarget,
        },
    });
    const bodyDrop = useDroppable({
        id: createCollectionDropTargetId(bodyTarget),
        disabled: props.dragSession?.kind !== 'tab',
        data: {
            dropTarget: bodyTarget,
        },
    });

    const style = isDragging
        ? {
            // Collapse to zero height so no empty space is left behind.
            height: 0,
            overflow: 'hidden',
            margin: 0,
            padding: 0,
            opacity: 0,
            pointerEvents: 'none',
            position: 'relative',
        }
        : {
            transform: CSS.Transform.toString(transform),
            position: 'relative',
        };

    return (
        <div ref={setNodeRef} style={style} className={'collection-draggable-group' + (props.isSettled ? ' dnd-settled' : '')}>
            <GroupContainer
                {...props}
                isDragging={isDragging}
                headerDropProps={headerDrop}
                bodyDropProps={bodyDrop}
                dragAttributes={props.disableDrag ? {} : attributes}
                dragListeners={props.disableDrag ? {} : listeners}
            />
        </div>
    );
}

export default SortableGroupContainer;
