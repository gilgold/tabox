import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from './helpers/renderWithProviders';
import MoveToCollectionModal from '../app/MoveToCollectionModal';
import { settingsDataState } from '../app/atoms/globalAppSettingsState';

jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showErrorToast: jest.fn(),
}));

const toastHelpers = require('../app/toastHelpers');

describe('MoveToCollectionModal', () => {
    const sourceCollection = {
        uid: 'collection-source',
        name: 'Source Collection',
        tabs: [
            {
                uid: 'tab-1',
                title: 'Source Tab',
                url: 'https://example.com',
                groupUid: 'group-1',
            },
        ],
        chromeGroups: [{ uid: 'group-1', title: 'Group' }],
    };

    const folderWrappedSettings = [
        {
            isFolder: true,
            uid: 'folder-1',
            name: 'Folder One',
            collections: [
                {
                    uid: 'collection-target',
                    name: 'Target Collection',
                    color: 'blue',
                    tabs: [{ uid: 'target-tab', url: 'https://openai.com' }],
                },
            ],
        },
        {
            uid: 'collection-root',
            name: 'Root Collection',
            color: 'default',
            tabs: [],
        },
        sourceCollection,
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('filters out the source collection, flattens folder collections, and moves a tab', async () => {
        const updateCollection = jest.fn(async () => true);
        const onTabMoved = jest.fn();
        const onClose = jest.fn();

        renderWithProviders(
            <MoveToCollectionModal
                isOpen
                onClose={onClose}
                tab={sourceCollection.tabs[0]}
                sourceCollection={sourceCollection}
                updateCollection={updateCollection}
                onTabMoved={onTabMoved}
            />,
            {
                atomValues: [[settingsDataState, folderWrappedSettings]],
            },
        );

        await act(async () => {
            jest.advanceTimersByTime(150);
        });

        expect(screen.getByText('Target Collection')).toBeInTheDocument();
        expect(screen.getByText('Root Collection')).toBeInTheDocument();
        expect(screen.queryByText('Source Collection')).not.toBeInTheDocument();
        expect(screen.getByText('1 tabs • in Folder One')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Target Collection'));

        await waitFor(() => {
            expect(updateCollection).toHaveBeenCalledTimes(2);
        });
        expect(updateCollection).toHaveBeenNthCalledWith(1, expect.objectContaining({
            uid: 'collection-source',
            tabs: [],
            chromeGroups: [],
        }), false);
        expect(updateCollection).toHaveBeenNthCalledWith(2, expect.objectContaining({
            uid: 'collection-target',
            tabs: expect.arrayContaining([
                expect.objectContaining({
                    uid: 'tab-1',
                    title: 'Source Tab',
                    url: 'https://example.com',
                }),
            ]),
        }), true);
        expect(toastHelpers.showSuccessToast).toHaveBeenCalledWith('Moved tab to "Target Collection"');
        expect(onTabMoved).toHaveBeenCalledWith(sourceCollection.tabs[0], expect.objectContaining({
            uid: 'collection-target',
        }));
        expect(onClose).toHaveBeenCalled();
    });

    test('supports search, empty states, and escape-to-close', async () => {
        const onClose = jest.fn();

        renderWithProviders(
            <MoveToCollectionModal
                isOpen
                onClose={onClose}
                tab={sourceCollection.tabs[0]}
                sourceCollection={sourceCollection}
                updateCollection={jest.fn(async () => true)}
            />,
            {
                atomValues: [[settingsDataState, folderWrappedSettings]],
            },
        );

        await act(async () => {
            jest.advanceTimersByTime(150);
        });

        fireEvent.change(screen.getByPlaceholderText('Search collections...'), {
            target: { value: 'does-not-exist' },
        });

        expect(screen.getByText('No collections match your search')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalled();
    });

    test('shows an error toast when the move fails', async () => {
        // The component intentionally logs the failure before showing the toast.
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const updateCollection = jest.fn(async () => {
            throw new Error('move failed');
        });

        renderWithProviders(
            <MoveToCollectionModal
                isOpen
                onClose={jest.fn()}
                tab={sourceCollection.tabs[0]}
                sourceCollection={sourceCollection}
                updateCollection={updateCollection}
            />,
            {
                atomValues: [[settingsDataState, folderWrappedSettings]],
            },
        );

        await act(async () => {
            jest.advanceTimersByTime(150);
        });

        fireEvent.click(screen.getByText('Target Collection'));

        await waitFor(() => {
            expect(toastHelpers.showErrorToast).toHaveBeenCalledWith('Failed to move tab');
        });
        expect(errorSpy).toHaveBeenCalledWith('Error moving tab:', expect.any(Error));
        errorSpy.mockRestore();
    });
});
