/* global browser */
import fs from 'fs';
import path from 'path';
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPSidebar from '../app/fullpage/FPSidebar';
import { sidebarCollapsedState, sidebarNavigationState } from '../app/atoms/fullpageState';
import { draggingCollectionState } from '../app/atoms/animationsState';
import { sharedActionConfirmState, pendingInvitesState } from '../app/atoms/sharedFoldersState';
import { respondToSharedInvite } from '../app/utils/sharedFolderActions';

let latestDragEndHandler = null;

jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children, onDragEnd }) => {
        latestDragEndHandler = onDragEnd;
        return <div data-testid="folder-dnd-context">{children}</div>;
    },
    PointerSensor: function PointerSensor() {},
    closestCenter: jest.fn(),
    useSensor: jest.fn(() => ({})),
    useSensors: jest.fn((...sensors) => sensors),
}));

jest.mock('@dnd-kit/sortable', () => ({
    arrayMove: (array, from, to) => {
        const next = [...array];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
    },
    SortableContext: ({ children }) => <>{children}</>,
    verticalListSortingStrategy: jest.fn(),
    useSortable: jest.fn(() => ({
        attributes: {},
        listeners: {},
        setNodeRef: jest.fn(),
        transform: null,
        transition: undefined,
        isDragging: false,
    })),
}));

jest.mock('@dnd-kit/utilities', () => ({
    CSS: {
        Transform: {
            toString: jest.fn(() => ''),
        },
    },
}));

jest.mock('../app/CreateFolderModal', () => function MockCreateFolderModal() {
    return null;
});

jest.mock('../app/FolderDeleteConfirmModal', () => function MockFolderDeleteConfirmModal() {
    return null;
});

jest.mock('../app/fullpage/SaveCollectionModal', () => function MockSaveCollectionModal() {
    return null;
});

jest.mock('../app/utils/sharedFolderActions', () => ({
    respondToSharedInvite: jest.fn().mockResolvedValue(true),
    leaveSharedFolder: jest.fn(),
    unshareSharedFolder: jest.fn(),
}));

jest.mock('../app/utils/folderOperations', () => ({
    moveCollectionToFolder: jest.fn(),
    duplicateFolder: jest.fn(),
    deleteFolder: jest.fn(),
    updateFolderDetails: jest.fn(),
}));

const renderWithStore = (ui, seedStore) => {
    const store = createStore();
    store.set(sidebarCollapsedState, false);
    store.set(sidebarNavigationState, 'all');
    if (seedStore) {
        seedStore(store);
    }

    return { ...render(<Provider store={store}>{ui}</Provider>), store };
};

describe('FPSidebar folder reorder', () => {
    beforeEach(() => {
        latestDragEndHandler = null;
        jest.clearAllMocks();
        browser.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    });

    test('reorders folders through updateFolders when a drag ends over another folder', async () => {
        const updateFolders = jest.fn().mockResolvedValue(true);

        renderWithStore(
            <FPSidebar
                folders={[
                    { uid: 'folder-1', name: 'Folder One', color: 'blue' },
                    { uid: 'folder-2', name: 'Folder Two', color: 'green' },
                    { uid: 'folder-3', name: 'Folder Three', color: 'red' },
                ]}
                collections={[]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={updateFolders}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        expect(screen.getByText('Folder One')).toBeInTheDocument();
        expect(latestDragEndHandler).toEqual(expect.any(Function));

        await act(async () => {
            await latestDragEndHandler({
                active: { id: 'folder-1' },
                over: { id: 'folder-3' },
            });
        });

        expect(updateFolders).toHaveBeenCalledWith([
            expect.objectContaining({ uid: 'folder-2' }),
            expect.objectContaining({ uid: 'folder-3' }),
            expect.objectContaining({ uid: 'folder-1' }),
        ]);
    });

    test('shows and refreshes the Current Windows count from browser window events', async () => {
        browser.windows.getAll
            .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
            .mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

        renderWithStore(
            <FPSidebar
                folders={[]}
                collections={[]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        const currentWindowsButton = await screen.findByText('Current Windows');
        expect(currentWindowsButton.closest('button')).toHaveTextContent('2');

        await act(async () => {
            browser.windows.onCreated.trigger({ id: 3 });
        });

        expect(currentWindowsButton.closest('button')).toHaveTextContent('3');
    });

    test('does not render a Recently Opened navigation item', async () => {
        renderWithStore(
            <FPSidebar
                folders={[]}
                collections={[
                    { uid: 'collection-1', name: 'Saved Tabs', lastOpened: Date.now() },
                ]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        await screen.findByText('All Collections');

        expect(screen.queryByText('Recently Opened')).not.toBeInTheDocument();
    });

    test('renders root level collections inside the folders section instead of the main nav list', async () => {
        renderWithStore(
            <FPSidebar
                folders={[
                    { uid: 'folder-1', name: 'Folder One', color: 'blue' },
                ]}
                collections={[
                    { uid: 'collection-1', name: 'Root Collection' },
                    { uid: 'collection-2', name: 'Folder Collection', parentId: 'folder-1' },
                ]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        await screen.findByText('Folders');

        expect(screen.queryByRole('button', { name: /^No Folder$/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Root Level/i })).toBeInTheDocument();
        expect(screen.getByText('Collections not saved in any folder')).toBeInTheDocument();
        expect(screen.getByText('Folder One')).toBeInTheDocument();
    });

    test('renders nav and folder counts through the shared sidebar counter', async () => {
        browser.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

        renderWithStore(
            <FPSidebar
                folders={[
                    { uid: 'folder-1', name: 'Folder One', color: 'blue' },
                    { uid: 'folder-2', name: 'Folder Two', color: 'green' },
                ]}
                collections={[
                    { uid: 'collection-1', name: 'Root Collection' },
                    { uid: 'collection-2', name: 'Folder Collection A', parentId: 'folder-1' },
                    { uid: 'collection-3', name: 'Folder Collection B', parentId: 'folder-1' },
                ]}
                sessionCount={25}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        await screen.findByText('All Collections');

        const counterValues = ['3', '25', '1', '2', '0'];
        counterValues.forEach((value) => {
            expect(screen.getAllByText(value).some((counter) => (
                counter.classList.contains('fp-sidebar-counter')
            ))).toBe(true);
        });

        expect(screen.getByText('Recently Closed').closest('button').querySelector('.fp-sidebar-counter')).toHaveTextContent('25');
        expect(screen.getByText('Root Level').closest('button').querySelector('.fp-sidebar-counter')).toHaveTextContent('1');
        expect(screen.getByText('Folder One').closest('button').querySelector('.fp-sidebar-counter')).toHaveTextContent('2');
        expect(screen.getByText('Folder Two').closest('button').querySelector('.fp-sidebar-counter')).toHaveTextContent('0');
    });

    test('does not mark Root Level as a drop target when the dragged collection is already at root', async () => {
        const folders = [{ uid: 'folder-1', name: 'Folder One', color: 'blue' }];
        const rootCollection = { uid: 'collection-1', name: 'Root Collection' };

        renderWithStore(
            <FPSidebar
                folders={folders}
                collections={[rootCollection]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
            (store) => {
                store.set(draggingCollectionState, { collection: rootCollection, overSidebarTarget: null });
            },
        );

        const rootLevelButton = (await screen.findByText('Root Level')).closest('button');
        expect(rootLevelButton).not.toHaveClass('fp-sidebar-drop-active');
        expect(rootLevelButton).not.toHaveClass('fp-sidebar-drop-over');
    });

    test('marks Root Level as a drop target when the dragged collection lives in a folder', async () => {
        const folders = [{ uid: 'folder-1', name: 'Folder One', color: 'blue' }];
        const folderCollection = { uid: 'collection-2', name: 'Folder Collection', parentId: 'folder-1' };

        renderWithStore(
            <FPSidebar
                folders={folders}
                collections={[folderCollection]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
            (store) => {
                store.set(draggingCollectionState, { collection: folderCollection, overSidebarTarget: null });
            },
        );

        const rootLevelButton = (await screen.findByText('Root Level')).closest('button');
        expect(rootLevelButton).toHaveClass('fp-sidebar-drop-active');
    });

    test('renders a Favorites nav item with correct count and navigates on click', async () => {
        const store = createStore();
        store.set(sidebarCollapsedState, false);
        store.set(sidebarNavigationState, 'all');

        render(
            <Provider store={store}>
                <FPSidebar
                    folders={[]}
                    collections={[
                        { uid: 'col-1', name: 'Alpha', isFavorite: true },
                        { uid: 'col-2', name: 'Beta', isFavorite: true },
                        { uid: 'col-3', name: 'Gamma' },
                    ]}
                    addCollection={jest.fn()}
                    addFolder={jest.fn()}
                    onDataUpdate={jest.fn()}
                    updateFolders={jest.fn()}
                    triggerSync={jest.fn()}
                    triggerFolderLightningEffect={jest.fn()}
                />
            </Provider>,
        );

        // Favorites nav item renders
        const favButton = await screen.findByRole('button', { name: /Favorites/i });
        expect(favButton).toBeInTheDocument();

        // Counter shows 2 (collections with isFavorite: true)
        expect(favButton.querySelector('.fp-sidebar-counter')).toHaveTextContent('2');

        // Clicking sets the navigation atom to 'favorites'
        await act(async () => {
            favButton.click();
        });
        expect(store.get(sidebarNavigationState)).toBe('favorites');
    });

    test('keeps the responsive save action as a visible icon-only button', () => {
        const cssPath = path.join(__dirname, '../app/fullpage/FPSidebar.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        const saveIconRule = css.match(/\.fp-sidebar-save-btn svg\s*{[^}]+}/)?.[0] || '';
        const compactRule = css.match(/@media \(max-width: 1100px\)\s*{[\s\S]+?\.fp-sidebar \.fp-sidebar-toggle\s*{[^}]+}[\s\S]+?}/)?.[0] || '';

        expect(saveIconRule).toContain('flex-shrink: 0');
        expect(compactRule).toMatch(/\.fp-sidebar \.fp-sidebar-save-section\s*{[^}]*padding:\s*48px 10px 12px/);
        expect(compactRule).toMatch(/\.fp-sidebar \.fp-sidebar-save-btn\s*{[^}]*width:\s*40px/);
        expect(compactRule).toMatch(/\.fp-sidebar \.fp-sidebar-save-btn\s*{[^}]*padding:\s*0/);
    });
});

// Fix round 3 (task-13-report.md "## Fix round 3"): the sidebar folder context
// menu had zero shared-folder gating - a read-only member (or the owner) could
// see and click plain "Delete Folder" on a shared folder. It must instead show
// the sharing-specific actions and never plain delete.
describe('FPSidebar shared folder context menu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    });

    test('shows Leave Shared Folder (and not Delete Folder) for a read-only shared folder', () => {
        renderWithStore(
            <FPSidebar
                folders={[
                    { uid: 'folder-1', name: 'Read Only Folder', color: 'blue', shared: { folderId: 'folder-1', role: 'read' } },
                ]}
                collections={[]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        fireEvent.contextMenu(screen.getByText('Read Only Folder').closest('button'));

        expect(screen.getByText('Leave Shared Folder')).toBeInTheDocument();
        expect(screen.queryByText('Delete Folder')).not.toBeInTheDocument();
    });

    test('shows Manage Sharing and Stop Sharing (and not Delete Folder) for a folder the user owns and shares', () => {
        renderWithStore(
            <FPSidebar
                folders={[
                    { uid: 'folder-1', name: 'Owned Shared Folder', color: 'blue', shared: { folderId: 'folder-1', role: 'owner', members: [] } },
                ]}
                collections={[]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        fireEvent.contextMenu(screen.getByText('Owned Shared Folder').closest('button'));

        expect(screen.getByText('Manage Sharing…')).toBeInTheDocument();
        expect(screen.getByText('Stop Sharing (keep my copy)')).toBeInTheDocument();
        expect(screen.queryByText('Delete Folder')).not.toBeInTheDocument();
        expect(screen.queryByText('Leave Shared Folder')).not.toBeInTheDocument();
    });

    test('shows plain Delete Folder for a non-shared, editable folder', () => {
        renderWithStore(
            <FPSidebar
                folders={[
                    { uid: 'folder-1', name: 'Plain Folder', color: 'blue' },
                ]}
                collections={[]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        fireEvent.contextMenu(screen.getByText('Plain Folder').closest('button'));

        expect(screen.getByText('Delete Folder')).toBeInTheDocument();
        expect(screen.queryByText('Leave Shared Folder')).not.toBeInTheDocument();
        expect(screen.queryByText('Manage Sharing…')).not.toBeInTheDocument();
    });

    test('shows the Pro badge on Share… for a non-Pro user', () => {
        renderWithStore(
            <FPSidebar
                folders={[
                    { uid: 'folder-1', name: 'Plain Folder', color: 'blue' },
                ]}
                collections={[]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        fireEvent.contextMenu(screen.getByText('Plain Folder').closest('button'));

        const shareRow = screen.getByText('Share…').closest('button');
        expect(shareRow).toContainElement(screen.getByLabelText('Tabox Pro feature'));
    });

    // Leave/Unshare confirmation hardening: clicking the menu entry must open
    // the shared SharedActionConfirmModal (via the sharedActionConfirmState
    // atom) instead of firing sharedLeaveFolder/sharedUnshareFolder directly.
    test('clicking "Stop Sharing" opens the confirm modal instead of sending sharedUnshareFolder directly', () => {
        const folder = { uid: 'folder-1', name: 'Owned Shared Folder', color: 'blue', shared: { folderId: 'folder-1', role: 'owner', members: [] } };
        const { store } = renderWithStore(
            <FPSidebar
                folders={[folder]}
                collections={[]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        fireEvent.contextMenu(screen.getByText('Owned Shared Folder').closest('button'));
        fireEvent.click(screen.getByText('Stop Sharing (keep my copy)'));

        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'sharedUnshareFolder' })
        );
        expect(store.get(sharedActionConfirmState)).toEqual({ kind: 'unshare', folder });
    });

    test('clicking "Leave Shared Folder" opens the confirm modal instead of sending sharedLeaveFolder directly', () => {
        const folder = { uid: 'folder-1', name: 'Read Only Folder', color: 'blue', shared: { folderId: 'folder-1', role: 'read' } };
        const { store } = renderWithStore(
            <FPSidebar
                folders={[folder]}
                collections={[]}
                addCollection={jest.fn()}
                addFolder={jest.fn()}
                onDataUpdate={jest.fn()}
                updateFolders={jest.fn()}
                triggerSync={jest.fn()}
                triggerFolderLightningEffect={jest.fn()}
            />,
        );

        fireEvent.contextMenu(screen.getByText('Read Only Folder').closest('button'));
        fireEvent.click(screen.getByText('Leave Shared Folder'));

        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'sharedLeaveFolder' })
        );
        expect(store.get(sharedActionConfirmState)).toEqual({ kind: 'leave', folder });
    });
});

describe('FPSidebar Shared Folders section', () => {
    const sharedFolder = {
        uid: 'shared-1',
        name: 'Team Folder',
        color: 'blue',
        shared: { folderId: 'shared-1', role: 'owner', members: [] },
    };
    const plainFolder = { uid: 'folder-1', name: 'Plain Folder', color: 'green' };
    const invite = {
        folderId: 'invite-folder-1',
        folderName: 'Marketing Links',
        ownerEmail: 'owner@example.com',
        role: 'read',
    };

    const defaultProps = {
        addCollection: jest.fn(),
        addFolder: jest.fn(),
        onDataUpdate: jest.fn(),
        updateFolders: jest.fn(),
        triggerSync: jest.fn(),
        triggerFolderLightningEffect: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        respondToSharedInvite.mockResolvedValue(true);
        browser.windows.getAll.mockResolvedValue([{ id: 1 }]);
    });

    test('renders shared folders in the Shared Folders section and excludes them from the regular list', () => {
        const { container } = renderWithStore(
            <FPSidebar
                folders={[sharedFolder, plainFolder]}
                collections={[{ uid: 'col-1', name: 'Shared Col', parentId: 'shared-1' }]}
                {...defaultProps}
            />,
        );

        expect(screen.getByText('Shared Folders')).toBeInTheDocument();

        const sharedSection = container.querySelector('.fp-sidebar-shared-section');
        expect(sharedSection).toHaveTextContent('Team Folder');
        expect(sharedSection).not.toHaveTextContent('Plain Folder');
        expect(sharedSection.closest('.fp-sidebar-folders')).not.toBeNull();

        // Shared folder must not be part of the sortable regular list.
        const sharedButton = screen.getByText('Team Folder').closest('button');
        expect(sharedButton.closest('[data-sidebar-folder-uid]')).toBeNull();
        expect(container.querySelectorAll('[data-sidebar-folder-uid]')).toHaveLength(1);
        expect(container.querySelector('[data-sidebar-folder-uid="folder-1"]')).not.toBeNull();

        // Count badge reflects the shared folder's collections.
        expect(sharedButton.querySelector('.fp-sidebar-counter')).toHaveTextContent('1');
    });

    test('shared folder rows navigate on click and show the shared context menu', () => {
        const { store } = renderWithStore(
            <FPSidebar
                folders={[sharedFolder]}
                collections={[]}
                {...defaultProps}
            />,
        );

        const sharedButton = screen.getByText('Team Folder').closest('button');
        fireEvent.click(sharedButton);
        expect(store.get(sidebarNavigationState)).toBe('shared-1');

        fireEvent.contextMenu(sharedButton);
        expect(screen.getByText('Manage Sharing…')).toBeInTheDocument();
        expect(screen.queryByText('Delete Folder')).not.toBeInTheDocument();
    });

    test('renders a ghost row for a pending invite with owner email and no count badge', () => {
        const { container } = renderWithStore(
            <FPSidebar
                folders={[]}
                collections={[]}
                {...defaultProps}
            />,
            (store) => {
                store.set(pendingInvitesState, [invite]);
            },
        );

        const ghost = container.querySelector('.fp-sidebar-ghost-row');
        expect(ghost).not.toBeNull();
        expect(ghost).toHaveTextContent('Marketing Links');
        expect(ghost).toHaveTextContent('owner@example.com');
        expect(ghost).toHaveTextContent('View only');
        expect(ghost.querySelector('.fp-sidebar-counter')).toBeNull();

        // Header shows the pending invite count badge.
        const header = container.querySelector('.fp-sidebar-shared-section .fp-sidebar-folders-header');
        expect(header.querySelector('.fp-sidebar-shared-pending-count')).toHaveTextContent('1');
    });

    test('Accept calls respondToSharedInvite with the invite and onDataUpdate', async () => {
        const onDataUpdate = jest.fn();
        renderWithStore(
            <FPSidebar
                folders={[]}
                collections={[]}
                {...defaultProps}
                onDataUpdate={onDataUpdate}
            />,
            (store) => {
                store.set(pendingInvitesState, [invite]);
            },
        );

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Accept invite to "Marketing Links"/i }));
        });

        expect(respondToSharedInvite).toHaveBeenCalledWith(invite, true, onDataUpdate);
    });

    test('Decline opens the shared confirm modal via the atom instead of acting directly', () => {
        const { store } = renderWithStore(
            <FPSidebar
                folders={[]}
                collections={[]}
                {...defaultProps}
            />,
            (store) => {
                store.set(pendingInvitesState, [invite]);
            },
        );

        fireEvent.click(screen.getByRole('button', { name: /Decline invite to "Marketing Links"/i }));

        expect(respondToSharedInvite).not.toHaveBeenCalled();
        expect(store.get(sharedActionConfirmState)).toEqual({ kind: 'decline-invite', invite });
    });

    test('hides the Shared Folders section when there are no shared folders or invites', () => {
        renderWithStore(
            <FPSidebar
                folders={[plainFolder]}
                collections={[]}
                {...defaultProps}
            />,
        );

        expect(screen.queryByText('Shared Folders')).not.toBeInTheDocument();
        expect(screen.getByText('Folders')).toBeInTheDocument();
        expect(screen.getByText('Plain Folder')).toBeInTheDocument();
    });
});
