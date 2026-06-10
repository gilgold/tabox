/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DroppableFolderContent from '../app/DroppableFolderContent';
import DroppableFolderHeader from '../app/DroppableFolderHeader';

let mockActive = null;
const mockUseDroppable = jest.fn();

jest.mock('@dnd-kit/core', () => ({
    useDroppable: (...args) => mockUseDroppable(...args),
    useDndContext: () => ({ active: mockActive }),
}));

describe('folder drop wrappers', () => {
    beforeEach(() => {
        mockActive = null;
        mockUseDroppable.mockReset();
    });

    test('shows the folder content drop zone only for external collections in expanded folders', () => {
        mockActive = {
            data: {
                current: {
                    itemType: 'collection',
                    parentId: 'other-folder',
                },
            },
        };

        mockUseDroppable.mockReturnValue({
            isOver: true,
            setNodeRef: jest.fn(),
        });

        render(
            <DroppableFolderContent folder={{ uid: 'folder-1', name: 'Research', collapsed: false }}>
                <div>Folder children</div>
            </DroppableFolderContent>,
        );

        expect(screen.getByText('Folder children')).toBeInTheDocument();
        expect(screen.getByText('📁 Add to Research')).toBeInTheDocument();
    });

    test('hides the folder content drop zone for drags from the same folder', () => {
        mockActive = {
            data: {
                current: {
                    itemType: 'collection',
                    parentId: 'folder-1',
                },
            },
        };

        mockUseDroppable.mockReturnValue({
            isOver: true,
            setNodeRef: jest.fn(),
        });

        render(
            <DroppableFolderContent folder={{ uid: 'folder-1', name: 'Research', collapsed: false }}>
                <div>Folder children</div>
            </DroppableFolderContent>,
        );

        expect(screen.queryByText(/Add to Research/)).not.toBeInTheDocument();
    });

    test('uses a stronger header drop affordance for collapsed folders', () => {
        mockActive = {
            data: {
                current: {
                    itemType: 'collection',
                    parentId: 'other-folder',
                },
            },
        };

        mockUseDroppable.mockReturnValue({
            isOver: true,
            setNodeRef: jest.fn(),
        });

        const { container } = render(
            <DroppableFolderHeader folder={{ uid: 'folder-1', name: 'Research', collapsed: true }}>
                <div>Folder header</div>
            </DroppableFolderHeader>,
        );

        expect(screen.getByText('📁 Drop into Research')).toBeInTheDocument();
        expect(container.firstChild).toHaveStyle('min-height: 60px');
    });

    test('does not show the header drop zone for folder drags', () => {
        mockActive = {
            data: {
                current: {
                    type: 'folder',
                },
            },
        };

        mockUseDroppable.mockReturnValue({
            isOver: true,
            setNodeRef: jest.fn(),
        });

        render(
            <DroppableFolderHeader folder={{ uid: 'folder-1', name: 'Research', collapsed: false }}>
                <div>Folder header</div>
            </DroppableFolderHeader>,
        );

        expect(screen.queryByText('📁 Add to Research')).not.toBeInTheDocument();
    });
});
