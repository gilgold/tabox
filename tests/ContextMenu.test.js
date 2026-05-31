import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from './helpers/renderWithProviders';
import ContextMenu from '../app/ContextMenu';

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
