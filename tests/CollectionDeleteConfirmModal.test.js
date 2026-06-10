/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CollectionDeleteConfirmModal from '../app/CollectionDeleteConfirmModal';

describe('CollectionDeleteConfirmModal', () => {
    test('renders the collection name and lets the user cancel', () => {
        const onClose = jest.fn();

        render(
            <CollectionDeleteConfirmModal
                isOpen={true}
                onClose={onClose}
                onConfirm={jest.fn()}
                collectionName="Work Tabs"
            />,
        );

        expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument();
        expect(screen.getByText('"Work Tabs"')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('confirms deletion from the keyboard enter shortcut', () => {
        const onConfirm = jest.fn();

        render(
            <CollectionDeleteConfirmModal
                isOpen={true}
                onClose={jest.fn()}
                onConfirm={onConfirm}
                collectionName="Reference"
            />,
        );

        fireEvent.keyDown(screen.getByRole('button', { name: 'Delete Collection' }), { key: 'Enter' });

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
