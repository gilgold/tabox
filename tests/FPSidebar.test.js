/* global browser */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPSidebar from '../app/fullpage/FPSidebar';
import { sidebarCollapsedState, sidebarNavigationState } from '../app/atoms/fullpageState';

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

jest.mock('../app/utils/folderOperations', () => ({
    moveCollectionToFolder: jest.fn(),
    duplicateFolder: jest.fn(),
    deleteFolder: jest.fn(),
    updateFolderDetails: jest.fn(),
}));

const renderWithStore = (ui) => {
    const store = createStore();
    store.set(sidebarCollapsedState, false);
    store.set(sidebarNavigationState, 'all');

    return render(<Provider store={store}>{ui}</Provider>);
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
