import { useRef } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from './helpers/renderWithProviders';
import ContextMenu from '../app/ContextMenu';

// Host that wires a triggerRef element to a ContextMenu, mirroring how
// CollectionTile / FolderContainer enable right-click on a whole region.
function RightClickHost({ menuItems, onOpenChange }) {
    const triggerRef = useRef(null);
    return (
        <div>
            <div ref={triggerRef} data-testid="trigger">Right click me</div>
            <ContextMenu menuItems={menuItems} triggerRef={triggerRef} onOpenChange={onOpenChange} />
            <button type="button">Outside</button>
        </div>
    );
}

describe('ContextMenu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('shows only visible menu items and invokes actions', async () => {
        const onEdit = jest.fn();
        const onDelete = jest.fn();

        const { container } = renderWithProviders(
            <ContextMenu
                tooltip="Open menu"
                menuItems={[
                    { id: 'edit', text: 'Edit', action: onEdit, condition: true },
                    { id: 'hidden', text: 'Hidden', action: jest.fn(), condition: false },
                    { id: 'delete', text: 'Delete', action: onDelete },
                ]}
            />,
        );

        fireEvent.click(container.querySelector('.menu-icon'));

        expect(screen.getByText('Edit')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
        expect(screen.queryByText('Hidden')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Edit'));

        expect(onEdit).toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.queryByText('Delete')).not.toBeInTheDocument();
        });
    });

    test('renders an empty-state item when no menu items are available', () => {
        const { container } = renderWithProviders(<ContextMenu menuItems={[]} />);

        fireEvent.click(container.querySelector('.menu-icon'));

        expect(screen.getByText('No menu items configured')).toBeInTheDocument();
    });

    test('renders a Pro badge at the end of a flagged menu row', () => {
        const { container } = renderWithProviders(
            <ContextMenu
                menuItems={[{ id: 'share', text: 'Share…', action: jest.fn(), proBadge: true }]}
            />,
        );

        fireEvent.click(container.querySelector('.menu-icon'));

        const shareRow = screen.getByText('Share…').closest('.context-menu-item');
        const badge = screen.getByLabelText('Tabox Pro feature');
        expect(shareRow).toContainElement(badge);
        expect(badge).toHaveTextContent('Pro');
        expect(badge).toHaveClass('pro-badge');
        expect(shareRow.lastElementChild).toBe(badge);
    });

    test('closes when clicking outside the menu', async () => {
        const { container } = renderWithProviders(
            <div>
                <ContextMenu menuItems={[{ text: 'Only item', action: jest.fn() }]} />
                <button type="button">Outside</button>
            </div>,
        );

        fireEvent.click(container.querySelector('.menu-icon'));
        expect(screen.getByText('Only item')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Outside'));

        await waitFor(() => {
            expect(screen.queryByText('Only item')).not.toBeInTheDocument();
        });
    });

    test('opens at the cursor when the trigger element is right-clicked', () => {
        renderWithProviders(
            <RightClickHost menuItems={[{ id: 'edit', text: 'Edit', action: jest.fn() }]} />,
        );

        // Menu is closed until the trigger is right-clicked.
        expect(screen.queryByText('Edit')).not.toBeInTheDocument();

        fireEvent.contextMenu(screen.getByTestId('trigger'), { clientX: 50, clientY: 60 });

        const menuItem = screen.getByText('Edit');
        expect(menuItem).toBeInTheDocument();

        const menu = document.querySelector('.context-menu');
        expect(menu).toHaveStyle('left: 50px');
        expect(menu).toHaveStyle('top: 60px');
    });

    test('right-click menu closes when clicking outside', async () => {
        renderWithProviders(
            <RightClickHost menuItems={[{ id: 'edit', text: 'Edit', action: jest.fn() }]} />,
        );

        fireEvent.contextMenu(screen.getByTestId('trigger'), { clientX: 50, clientY: 60 });
        expect(screen.getByText('Edit')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Outside'));

        await waitFor(() => {
            expect(screen.queryByText('Edit')).not.toBeInTheDocument();
        });
    });

    test('reports open state changes to the parent', async () => {
        const onOpenChange = jest.fn();

        const { container } = renderWithProviders(
            <div>
                <ContextMenu
                    menuItems={[{ text: 'Only item', action: jest.fn() }]}
                    onOpenChange={onOpenChange}
                />
                <button type="button">Outside</button>
            </div>,
        );

        fireEvent.click(container.querySelector('.menu-icon'));

        expect(onOpenChange).toHaveBeenCalledWith(true);

        fireEvent.click(screen.getByText('Outside'));

        await waitFor(() => {
            expect(onOpenChange).toHaveBeenCalledWith(false);
        });
    });
});
