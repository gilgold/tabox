import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DropGap from '../app/DropGap';
import SortableGroupContainer from '../app/SortableGroupContainer';
import SortableTabRow from '../app/SortableTabRow';
import {
    collectionDropTargetTypes,
    createCollectionDropTargetId,
} from '../app/utils/collectionDragUtils';

const mockUseDraggable = jest.fn();
const mockUseDroppable = jest.fn();
const mockUseSortable = jest.fn();

jest.mock('@dnd-kit/core', () => ({
    useDraggable: (...args) => mockUseDraggable(...args),
    useDroppable: (...args) => mockUseDroppable(...args),
}));

jest.mock('@dnd-kit/sortable', () => ({
    useSortable: (...args) => mockUseSortable(...args),
}));

jest.mock('@dnd-kit/utilities', () => ({
    CSS: {
        Transform: {
            toString: jest.fn(() => ''),
        },
    },
}));

const baseDraggableReturn = {
    attributes: { role: 'button', 'aria-describedby': 'drag-handle' },
    listeners: { onPointerDown: jest.fn() },
    setNodeRef: jest.fn(),
    transform: null,
    isDragging: false,
};

const baseDroppableReturn = {
    isOver: false,
    setNodeRef: jest.fn(),
};

const collection = {
    uid: 'collection-1',
    tabs: [],
    chromeGroups: [],
};

const group = {
    uid: 'group-1',
    id: 1,
    title: 'Work',
    color: 'blue',
};

const tab = {
    uid: 'tab-1',
    title: 'Example tab',
    url: 'https://example.com',
    groupId: -1,
};

beforeEach(() => {
    mockUseDraggable.mockReset();
    mockUseDroppable.mockReset();
    mockUseSortable.mockReset();
    mockUseDraggable.mockReturnValue(baseDraggableReturn);
    mockUseDroppable.mockImplementation(() => baseDroppableReturn);
    mockUseSortable.mockReturnValue({
        ...baseDraggableReturn,
        transition: undefined,
    });
});

describe('DropGap component', () => {
    test('renders nothing visible when inactive', () => {
        const target = {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-1',
            side: 'before',
        };

        const { container } = render(
            <DropGap dropTarget={target} disabled={false} variant="tab" />,
        );

        const gap = container.firstChild;
        expect(gap.className).toContain('drop-gap');
        expect(gap.className).not.toContain('is-over');
        expect(gap.querySelector('.drop-gap-indicator')).toBeNull();
    });

    test('expands with indicator when isOver is true', () => {
        mockUseDroppable.mockReturnValue({ ...baseDroppableReturn, isOver: true });

        const target = {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-1',
            side: 'before',
        };

        const { container } = render(
            <DropGap dropTarget={target} disabled={false} variant="tab" />,
        );

        const gap = container.firstChild;
        expect(gap.className).toContain('is-over');
        expect(gap.querySelector('.drop-gap-indicator')).toBeTruthy();
    });

    test('passes correct dropTarget data to useDroppable', () => {
        const target = {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-1',
            side: 'before',
        };

        render(
            <DropGap dropTarget={target} disabled={false} variant="tab" />,
        );

        expect(mockUseDroppable).toHaveBeenCalledWith(
            expect.objectContaining({
                id: createCollectionDropTargetId(target),
                disabled: false,
                data: { dropTarget: target },
            }),
        );
    });

    test('respects disabled prop', () => {
        const target = {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-1',
            side: 'before',
        };

        render(
            <DropGap dropTarget={target} disabled={true} variant="tab" />,
        );

        expect(mockUseDroppable).toHaveBeenCalledWith(
            expect.objectContaining({
                disabled: true,
            }),
        );
    });

    test('does not show indicator when isOver but disabled', () => {
        mockUseDroppable.mockReturnValue({ ...baseDroppableReturn, isOver: true });

        const target = {
            type: collectionDropTargetTypes.TAB_EDGE,
            tabId: 'tab-1',
            side: 'before',
        };

        const { container } = render(
            <DropGap dropTarget={target} disabled={true} variant="tab" />,
        );

        const gap = container.firstChild;
        expect(gap.querySelector('.drop-gap-indicator')).toBeNull();
    });

    test('uses variant-group class for group variant', () => {
        const target = {
            type: collectionDropTargetTypes.GROUP_EDGE,
            groupUid: 'group-1',
            side: 'before',
        };

        const { container } = render(
            <DropGap dropTarget={target} disabled={false} variant="group" />,
        );

        expect(container.firstChild.className).toContain('variant-group');
    });
});

describe('collection drag components', () => {
    test('attaches draggable attributes only to the tab handle', () => {
        const { container } = render(
            <SortableTabRow
                tab={tab}
                updateCollection={jest.fn()}
                collection={collection}
                group={null}
                disableDrag={false}
                dragSession={{ kind: 'tab', itemId: 'other-tab' }}
            />,
        );

        const handle = container.querySelector('.drag-handle');
        const row = container.querySelector('.single-tab-row');

        expect(handle.getAttribute('role')).toBe('button');
        expect(row.getAttribute('role')).toBeNull();
    });

    test('passes sortable identity and metadata for tab drags', () => {
        render(
            <SortableTabRow
                tab={tab}
                updateCollection={jest.fn()}
                collection={collection}
                group={null}
                disableDrag={false}
                dragSession={{ kind: 'tab', itemId: 'other-tab' }}
            />,
        );

        expect(mockUseSortable).toHaveBeenCalledWith({
            id: tab.uid,
            disabled: false,
            data: {
                itemType: 'tab',
                tabId: tab.uid,
                groupUid: null,
                pinned: false,
            },
        });
    });

    test('hides the dragged source row visually but preserves layout', () => {
        mockUseSortable.mockReturnValue({
            ...baseDraggableReturn,
            transition: undefined,
            isDragging: true,
        });

        const { container } = render(
            <SortableTabRow
                tab={tab}
                updateCollection={jest.fn()}
                collection={collection}
                group={null}
                disableDrag={false}
                dragSession={{ kind: 'tab', itemId: tab.uid }}
            />,
        );

        const style = container.firstChild.getAttribute('style');
        expect(style).toContain('opacity: 0.35');
        expect(style).not.toContain('height: 0');
    });

    test('disables sortable behavior when drag is disabled', () => {
        render(
            <SortableTabRow
                tab={tab}
                updateCollection={jest.fn()}
                collection={collection}
                group={null}
                disableDrag={true}
                dragSession={{ kind: 'tab', itemId: 'other-tab' }}
            />,
        );

        expect(mockUseSortable).toHaveBeenCalledWith(expect.objectContaining({
            id: tab.uid,
            disabled: true,
        }));
    });

    test('renders the group header add target affordance when hovered by a tab drag', () => {
        mockUseDroppable
            .mockReturnValueOnce({ ...baseDroppableReturn, isOver: true })
            .mockReturnValueOnce(baseDroppableReturn);

        render(
            <SortableGroupContainer
                group={group}
                tabs={[{ ...tab, groupUid: group.uid, groupId: group.id }]}
                collection={{ ...collection, chromeGroups: [group] }}
                onSaveGroupColor={jest.fn()}
                onSaveGroupName={jest.fn()}
                onDeleteGroup={jest.fn()}
                isExpanded
                onToggleExpanded={jest.fn()}
                disableDrag={false}
                dragSession={{ kind: 'tab', itemId: 'other-tab' }}
            >
                <div>Grouped tab</div>
            </SortableGroupContainer>,
        );

        expect(screen.getByText('Add to Work')).toBeTruthy();
    });

    test('highlights the group body add target when the body drop zone is active', () => {
        mockUseDroppable
            .mockReturnValueOnce(baseDroppableReturn)
            .mockReturnValueOnce({ ...baseDroppableReturn, isOver: true });

        const { container } = render(
            <SortableGroupContainer
                group={group}
                tabs={[{ ...tab, groupUid: group.uid, groupId: group.id }]}
                collection={{ ...collection, chromeGroups: [group] }}
                onSaveGroupColor={jest.fn()}
                onSaveGroupName={jest.fn()}
                onDeleteGroup={jest.fn()}
                isExpanded
                onToggleExpanded={jest.fn()}
                disableDrag={false}
                dragSession={{ kind: 'tab', itemId: 'other-tab' }}
            >
                <div>Grouped tab</div>
            </SortableGroupContainer>,
        );

        const body = container.querySelector('.group-tabs-container');
        expect(body.getAttribute('style')).toContain('outline: 2px dashed');
    });

    test('opens all tabs in a group from the group header action', () => {
        const onOpenGroupTabs = jest.fn();

        render(
            <SortableGroupContainer
                group={group}
                tabs={[{ ...tab, groupUid: group.uid, groupId: group.id }]}
                collection={{ ...collection, chromeGroups: [group] }}
                onSaveGroupColor={jest.fn()}
                onSaveGroupName={jest.fn()}
                onDeleteGroup={jest.fn()}
                onOpenGroupTabs={onOpenGroupTabs}
                isExpanded
                onToggleExpanded={jest.fn()}
                disableDrag={false}
                dragSession={{ kind: 'tab', itemId: 'other-tab' }}
            >
                <div>Grouped tab</div>
            </SortableGroupContainer>,
        );

        fireEvent.click(screen.getByRole('button', { name: /open all tabs in work/i }));

        expect(onOpenGroupTabs).toHaveBeenCalledWith(group);
    });
});
