/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CommandPalette from '../app/CommandPalette';
import { commandPaletteOpenState } from '../app/atoms/commandPaletteState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const FOLDER_A = { uid: 'f-a', name: 'Folder A' };
const FOLDER_B = { uid: 'f-b', name: 'Folder B' };
const FOLDER_C = { uid: 'f-c', name: 'Folder C' };

const COLLECTION_IN_FOLDER_A = {
    uid: 'c-1',
    name: 'Collection in Folder A',
    parentId: 'f-a',
    tabs: [{ url: 'https://example.com', title: 'Example' }],
};

const COLLECTION_IN_FOLDER_B = {
    uid: 'c-2',
    name: 'Collection in Folder B',
    parentId: 'f-b',
    tabs: [],
};

function renderPalette({ collections = [], folders = [], onCollectionAction = jest.fn() } = {}) {
    const store = createStore();
    store.set(commandPaletteOpenState, true);
    store.set(viewContextState, 'popup');
    store.set(premiumEntitlementState, null);

    render(
        <Provider store={store}>
            <CommandPalette
                collections={collections}
                folders={folders}
                folderNameMap={{}}
                onCreateFolder={jest.fn()}
                onImport={jest.fn()}
                onExportAll={jest.fn()}
                onOpenFullPage={jest.fn()}
                onRestoreSession={jest.fn()}
                onCollectionAction={onCollectionAction}
                onOpenAiTool={jest.fn()}
                onManageSubscription={jest.fn()}
                onShareFolder={jest.fn()}
            />
        </Provider>,
    );
    return { onCollectionAction };
}

describe('CommandPalette — Move to Folder action', () => {
    beforeEach(() => {
        browser.storage.local.get.mockResolvedValue({ theme: 'light' });
    });

    test('move-to-folder sub-action exists in COLLECTION_SUB_ACTIONS', async () => {
        renderPalette({ collections: [COLLECTION_IN_FOLDER_A], folders: [FOLDER_A, FOLDER_B] });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');

        // Select the collection
        fireEvent.change(input, { target: { value: COLLECTION_IN_FOLDER_A.name } });
        const collectionRow = await screen.findByText(COLLECTION_IN_FOLDER_A.name);
        fireEvent.click(collectionRow);

        // Should show "Move to Folder" action
        expect(await screen.findByText('Move to Folder')).toBeInTheDocument();
    });

    test('selecting move-to-folder shows folder picker with root option when collection is in a folder', async () => {
        renderPalette({
            collections: [COLLECTION_IN_FOLDER_A],
            folders: [FOLDER_A, FOLDER_B, FOLDER_C],
        });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');

        // Select the collection
        fireEvent.change(input, { target: { value: COLLECTION_IN_FOLDER_A.name } });
        const collectionRow = await screen.findByText(COLLECTION_IN_FOLDER_A.name);
        fireEvent.click(collectionRow);

        // Click "Move to Folder"
        const moveBtn = await screen.findByText('Move to Folder');
        fireEvent.click(moveBtn);

        // Should show the root option (since collection is in a folder)
        expect(await screen.findByText('No Folder (Root)')).toBeInTheDocument();

        // Should show other folders
        expect(screen.getByText('Folder B')).toBeInTheDocument();
        expect(screen.getByText('Folder C')).toBeInTheDocument();

        // Should NOT show the current parent folder (Folder A)
        expect(screen.queryByText('Folder A')).not.toBeInTheDocument();
    });

    test('selecting a different folder calls onCollectionAction with correct params', async () => {
        const { onCollectionAction } = renderPalette({
            collections: [COLLECTION_IN_FOLDER_A],
            folders: [FOLDER_A, FOLDER_B, FOLDER_C],
        });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');

        // Select the collection
        fireEvent.change(input, { target: { value: COLLECTION_IN_FOLDER_A.name } });
        const collectionRow = await screen.findByText(COLLECTION_IN_FOLDER_A.name);
        fireEvent.click(collectionRow);

        // Click "Move to Folder"
        const moveBtn = await screen.findByText('Move to Folder');
        fireEvent.click(moveBtn);

        // Click Folder B
        const folderBRow = await screen.findByText('Folder B');
        fireEvent.click(folderBRow);

        // Should call onCollectionAction with correct params
        await waitFor(() =>
            expect(onCollectionAction).toHaveBeenCalledWith(
                COLLECTION_IN_FOLDER_A,
                'move',
                { targetFolderId: 'f-b' }
            )
        );
    });

    test('selecting root option calls onCollectionAction with targetFolderId as null', async () => {
        const { onCollectionAction } = renderPalette({
            collections: [COLLECTION_IN_FOLDER_A],
            folders: [FOLDER_A, FOLDER_B],
        });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');

        // Select the collection
        fireEvent.change(input, { target: { value: COLLECTION_IN_FOLDER_A.name } });
        const collectionRow = await screen.findByText(COLLECTION_IN_FOLDER_A.name);
        fireEvent.click(collectionRow);

        // Click "Move to Folder"
        const moveBtn = await screen.findByText('Move to Folder');
        fireEvent.click(moveBtn);

        // Click "No Folder (Root)"
        const rootOption = await screen.findByText('No Folder (Root)');
        fireEvent.click(rootOption);

        // Should call onCollectionAction with targetFolderId as null
        await waitFor(() =>
            expect(onCollectionAction).toHaveBeenCalledWith(
                COLLECTION_IN_FOLDER_A,
                'move',
                { targetFolderId: null }
            )
        );
    });

    test('move-to-folder works across different collections in different folders', async () => {
        const { onCollectionAction } = renderPalette({
            collections: [COLLECTION_IN_FOLDER_A, COLLECTION_IN_FOLDER_B],
            folders: [FOLDER_A, FOLDER_B, FOLDER_C],
        });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');

        // Select the second collection (in Folder B)
        fireEvent.change(input, { target: { value: COLLECTION_IN_FOLDER_B.name } });
        const collectionRow = await screen.findByText(COLLECTION_IN_FOLDER_B.name);
        fireEvent.click(collectionRow);

        // Click "Move to Folder"
        const moveBtn = await screen.findByText('Move to Folder');
        fireEvent.click(moveBtn);

        // Should show root option, Folder A, Folder C, but NOT Folder B (current parent)
        expect(await screen.findByText('No Folder (Root)')).toBeInTheDocument();
        expect(screen.getByText('Folder A')).toBeInTheDocument();
        expect(screen.getByText('Folder C')).toBeInTheDocument();
        expect(screen.queryByText('Folder B')).not.toBeInTheDocument();

        // Click Folder A
        const folderARow = screen.getByText('Folder A');
        fireEvent.click(folderARow);

        // Should call onCollectionAction with correct params
        await waitFor(() =>
            expect(onCollectionAction).toHaveBeenCalledWith(
                COLLECTION_IN_FOLDER_B,
                'move',
                { targetFolderId: 'f-a' }
            )
        );
    });

    test('folder picker is searchable while in move mode', async () => {
        renderPalette({
            collections: [COLLECTION_IN_FOLDER_A],
            folders: [FOLDER_A, FOLDER_B, FOLDER_C],
        });
        const input = await screen.findByPlaceholderText('Search collections, actions, or settings...');

        // Select the collection
        fireEvent.change(input, { target: { value: COLLECTION_IN_FOLDER_A.name } });
        const collectionRow = await screen.findByText(COLLECTION_IN_FOLDER_A.name);
        fireEvent.click(collectionRow);

        // Click "Move to Folder"
        const moveBtn = await screen.findByText('Move to Folder');
        fireEvent.click(moveBtn);

        // Initially, all folders are visible
        expect(screen.getByText('No Folder (Root)')).toBeInTheDocument();
        expect(screen.getByText('Folder B')).toBeInTheDocument();
        expect(screen.getByText('Folder C')).toBeInTheDocument();

        // Filter by searching for "Folder C"
        const pickerInput = screen.getByPlaceholderText('Pick a folder...');
        fireEvent.change(pickerInput, { target: { value: 'Folder C' } });

        // Should only show matching folder
        expect(screen.getByText('Folder C')).toBeInTheDocument();
        expect(screen.queryByText('Folder B')).not.toBeInTheDocument();
        expect(screen.queryByText('No Folder (Root)')).not.toBeInTheDocument();
    });
});
