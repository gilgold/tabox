/**
 * Fix-round test for gap 1 in task-13-report.md ("Known scope gaps" #1):
 * `useCollectionOperations`'s `folders` param (used by the delete guard and
 * undo-restore filter) was never threaded through its 4 call sites, making
 * the guard a no-op in the live UI. This file proves each call site now
 * passes real folder data into the hook.
 *
 * Note: this mocks `useCollectionOperations` itself, so it only proves
 * wiring (the right `folders` value reaches the hook call), not the guard's
 * runtime behavior. See tests/sharedFolderGuards.deleteGuard.test.js for a
 * render-level test of the actual blocked-delete behavior, and
 * tests/sharedFolderGuards.dragGuard.test.js for the drag-out-of-folder guard.
 */

/** @jest-environment jsdom */
import { act, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';

const READ_ONLY_FOLDER = { uid: 'folder-1', shared: { folderId: 'folder-1', role: 'read' } };

let mockCollectionHandlers;
const mockUseCollectionOperations = jest.fn(() => mockCollectionHandlers);

jest.mock('../app/useCollectionOperations', () => ({
    useCollectionOperations: (...args) => mockUseCollectionOperations(...args),
}));

jest.mock('../app/ContextMenu', () => function MockContextMenu() {
    return null;
});

jest.mock('../app/ColorPicker', () => function MockColorPicker() {
    return null;
});

jest.mock('../app/ExpandedCollectionData', () => function MockExpandedCollectionData() {
    return null;
});

jest.mock('../app/DroppableCollection', () => function MockDroppableCollection({ children }) {
    return <>{children}</>;
});

jest.mock('../app/utils/contextMenuItems', () => ({
    createCollectionMenuItems: jest.fn(() => []),
}));

jest.mock('javascript-time-ago', () => jest.fn().mockImplementation(() => ({
    format: jest.fn(() => 'Recently'),
})));

jest.mock('../app/ai/useTaboxAIEnabled', () => ({
    useTaboxAIEnabled: jest.fn(() => false),
}));

jest.mock('../app/ai/aiClient', () => ({
    isAISupported: jest.fn(() => false),
}));

jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    loadAllFolders: jest.fn(),
}));

const CollectionListItem = require('../app/CollectionListItem').default;
const CollectionTile = require('../app/CollectionTile').default;
const CollectionDetailPanel = require('../app/CollectionDetailPanel').default;
const FPCollectionCard = require('../app/fullpage/FPCollectionCard').default;
const storageUtils = require('../app/utils/storageUtils');

const baseCollection = {
    uid: 'collection-1',
    name: 'Shared collection',
    parentId: 'folder-1',
    tabs: [],
    chromeGroups: [],
};

describe('call sites pass folders into useCollectionOperations', () => {
    beforeEach(() => {
        mockCollectionHandlers = {
            _handleDelete: jest.fn(),
            _handleDuplicate: jest.fn(),
            _exportCollectionToFile: jest.fn(),
            _handleUpdate: jest.fn(),
            _handleOpenTabs: jest.fn(),
            _handleFocusWindow: jest.fn(),
            _handleStopTracking: jest.fn(),
            _handleToggleFavorite: jest.fn(),
        };
        mockUseCollectionOperations.mockClear();
        storageUtils.loadAllFolders.mockReset().mockResolvedValue([]);
    });

    test('CollectionListItem passes its folders prop straight through', async () => {
        await act(async () => {
            render(
                <Provider>
                    <CollectionListItem
                        collection={baseCollection}
                        index={0}
                        removeCollection={jest.fn()}
                        updateCollection={jest.fn()}
                        updateRemoteData={jest.fn()}
                        addCollection={jest.fn()}
                        onDataUpdate={jest.fn()}
                        dragHandleProps={{ attributes: {}, listeners: {} }}
                        folders={[READ_ONLY_FOLDER]}
                    />
                </Provider>,
            );
        });

        expect(mockUseCollectionOperations).toHaveBeenCalledWith(
            expect.objectContaining({ folders: [READ_ONLY_FOLDER] }),
        );
    });

    test('CollectionTile passes its folders prop straight through', async () => {
        await act(async () => {
            render(
                <Provider>
                    <CollectionTile
                        collection={baseCollection}
                        index={0}
                        removeCollection={jest.fn()}
                        updateCollection={jest.fn()}
                        updateRemoteData={jest.fn()}
                        addCollection={jest.fn()}
                        onDataUpdate={jest.fn()}
                        folders={[READ_ONLY_FOLDER]}
                    />
                </Provider>,
            );
        });

        expect(mockUseCollectionOperations).toHaveBeenCalledWith(
            expect.objectContaining({ folders: [READ_ONLY_FOLDER] }),
        );
    });

    test('CollectionDetailPanel passes its folders prop straight through', async () => {
        await act(async () => {
            render(
                <Provider>
                    <CollectionDetailPanel
                        collection={baseCollection}
                        isOpen={true}
                        onClose={jest.fn()}
                        updateCollection={jest.fn()}
                        removeCollection={jest.fn()}
                        updateRemoteData={jest.fn()}
                        addCollection={jest.fn()}
                        onDataUpdate={jest.fn()}
                        renderInline={true}
                        folders={[READ_ONLY_FOLDER]}
                    />
                </Provider>,
            );
        });

        expect(mockUseCollectionOperations).toHaveBeenCalledWith(
            expect.objectContaining({ folders: [READ_ONLY_FOLDER] }),
        );
    });

    test('FPCollectionCard passes an explicit folders prop straight through (skips self-fetch)', async () => {
        await act(async () => {
            render(
                <Provider>
                    <FPCollectionCard
                        collection={baseCollection}
                        index={0}
                        onSelect={jest.fn()}
                        updateCollection={jest.fn()}
                        removeCollection={jest.fn()}
                        updateRemoteData={jest.fn()}
                        addCollection={jest.fn()}
                        onDataUpdate={jest.fn()}
                        folders={[READ_ONLY_FOLDER]}
                    />
                </Provider>,
            );
        });

        expect(storageUtils.loadAllFolders).not.toHaveBeenCalled();
        expect(mockUseCollectionOperations).toHaveBeenCalledWith(
            expect.objectContaining({ folders: [READ_ONLY_FOLDER] }),
        );
    });

    test('FPCollectionCard self-fetches current folders when no folders prop is supplied', async () => {
        storageUtils.loadAllFolders.mockResolvedValue([READ_ONLY_FOLDER]);

        await act(async () => {
            render(
                <Provider>
                    <FPCollectionCard
                        collection={baseCollection}
                        index={0}
                        onSelect={jest.fn()}
                        updateCollection={jest.fn()}
                        removeCollection={jest.fn()}
                        updateRemoteData={jest.fn()}
                        addCollection={jest.fn()}
                        onDataUpdate={jest.fn()}
                    />
                </Provider>,
            );
        });

        expect(storageUtils.loadAllFolders).toHaveBeenCalled();
        expect(mockUseCollectionOperations).toHaveBeenCalledWith(
            expect.objectContaining({ folders: [READ_ONLY_FOLDER] }),
        );
    });
});
