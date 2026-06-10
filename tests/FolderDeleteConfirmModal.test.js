/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FolderDeleteConfirmModal from '../app/FolderDeleteConfirmModal';
import { browser } from '../static/globals';

jest.mock('../static/globals', () => ({
    browser: {
        storage: {
            local: {
                get: jest.fn(),
                set: jest.fn(),
            },
        },
    },
}));

describe('FolderDeleteConfirmModal', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({
            folderDeleteWithCollections: true,
        });
        browser.storage.local.set.mockResolvedValue(undefined);
    });

    test('loads the saved preference, persists checkbox changes, and confirms the selected mode', async () => {
        const onConfirm = jest.fn();

        render(
            <FolderDeleteConfirmModal
                isOpen={true}
                onClose={jest.fn()}
                onConfirm={onConfirm}
                folderName="Research"
                collectionCount={2}
            />,
        );

        const checkbox = await screen.findByRole('checkbox');
        await waitFor(() => {
            expect(checkbox).toBeChecked();
        });

        fireEvent.click(checkbox);

        await waitFor(() => {
            expect(browser.storage.local.set).toHaveBeenCalledWith({
                folderDeleteWithCollections: false,
            });
        });

        fireEvent.click(screen.getByRole('button', { name: 'Delete Folder' }));

        expect(onConfirm).toHaveBeenCalledWith(false);
    });
});
