/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FPEmptyState from '../app/fullpage/FPEmptyState';
import BulkDeleteCollectionsModal from '../app/fullpage/BulkDeleteCollectionsModal';
import BulkMoveCollectionsModal from '../app/fullpage/BulkMoveCollectionsModal';

jest.mock('../app/utils/colorMigration', () => ({
    getColorValue: jest.fn(() => '#123456'),
}));

describe('full-page empty states and modals', () => {
    test('renders empty states with either icon actions or an image', () => {
        const action = jest.fn();
        const { rerender } = render(
            <FPEmptyState
                icon={<span>Icon</span>}
                title="Nothing here"
                description="Create something first"
                actions={[{ label: 'Create', onClick: action }]}
            />,
        );

        expect(screen.getByText('Nothing here')).toBeInTheDocument();
        expect(screen.getByText('Create something first')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        expect(action).toHaveBeenCalledTimes(1);

        rerender(
            <FPEmptyState
                imageSrc="/empty.png"
                imageAlt="Empty state art"
                title="Still empty"
            />,
        );

        expect(screen.getByAltText('Empty state art')).toBeInTheDocument();
    });

    test('confirms bulk delete from the keyboard and supports cancel', () => {
        const onConfirm = jest.fn();
        const onClose = jest.fn();

        render(
            <BulkDeleteCollectionsModal
                isOpen={true}
                onClose={onClose}
                onConfirm={onConfirm}
                selectedCount={2}
            />,
        );

        expect(screen.getByText((content, element) => (
            element?.className === 'delete-confirm-question'
            && content.includes('Delete')
            && content.includes('selected collections')
        ))).toBeInTheDocument();

        fireEvent.keyDown(screen.getByRole('button', { name: 'Delete Collections' }), { key: 'Enter' });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('moves collections to the selected folder and handles empty folder lists', () => {
        jest.useFakeTimers();
        const onConfirm = jest.fn();
        const onClose = jest.fn();
        const { rerender } = render(
            <BulkMoveCollectionsModal
                isOpen={true}
                onClose={onClose}
                onConfirm={onConfirm}
                selectedCount={3}
                folders={[
                    { uid: 'folder-1', name: 'Research', color: 'blue' },
                    { uid: 'folder-2', name: 'Archive', color: 'green' },
                ]}
            />,
        );

        act(() => {
            jest.runAllTimers();
        });

        fireEvent.change(screen.getByLabelText('Destination Folder'), { target: { value: 'folder-2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Move Collections' }));
        fireEvent.keyDown(screen.getByLabelText('Destination Folder'), { key: 'Escape' });

        expect(onConfirm).toHaveBeenCalledWith('folder-2');
        expect(onClose).toHaveBeenCalledTimes(1);

        rerender(
            <BulkMoveCollectionsModal
                isOpen={true}
                onClose={onClose}
                onConfirm={onConfirm}
                selectedCount={1}
                folders={[]}
            />,
        );

        expect(screen.getByText(/Create a folder first to use bulk move/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Move Collections' })).toBeDisabled();
        jest.useRealTimers();
    });
});
