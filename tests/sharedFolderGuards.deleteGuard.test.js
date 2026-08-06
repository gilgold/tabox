/**
 * Fix-round render-level test for gap 1 in task-13-report.md: proves that
 * with real folder data now wired through (see
 * tests/sharedFolderGuards.wiring.test.js), a delete attempt on a collection
 * inside a read-only shared folder is actually blocked by the real
 * `useCollectionOperations` hook — the no-permission modal opens and nothing
 * is deleted. Uses CollectionDetailPanel as the exercised call site.
 */

/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CollectionDetailPanel from '../app/CollectionDetailPanel';
import { noPermissionOpenState } from '../app/atoms/sharedFoldersState';

jest.mock('javascript-time-ago', () => jest.fn().mockImplementation(() => ({
    format: jest.fn(() => '4 hours ago'),
})));

jest.mock('../app/ColorPicker', () => function MockColorPicker() {
    return <div data-testid="color-picker" />;
});

jest.mock('../app/ExpandedCollectionData', () => function MockExpandedCollectionData() {
    return <div data-testid="expanded-collection-data" />;
});

jest.mock('../app/utils', () => ({
    downloadTextFile: jest.fn(),
    getCurrentTabsAndGroups: jest.fn(),
    generateCopyName: jest.fn(),
    applyUid: jest.fn((value) => value),
}));

jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    showSuccessToast: jest.fn(),
    showErrorToast: jest.fn(),
    showInfoToast: jest.fn(),
}));

jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
    deleteSingleCollection: jest.fn(),
    updateFolderCollectionCount: jest.fn(),
    loadSingleCollection: jest.fn(),
}));

const storageUtils = require('../app/utils/storageUtils');
const toastHelpers = require('../app/toastHelpers');

const READ_ONLY_FOLDER = { uid: 'folder-1', shared: { folderId: 'folder-1', role: 'read' } };
const WRITABLE_FOLDER = { uid: 'folder-1', shared: { folderId: 'folder-1', role: 'write' } };

const collection = {
    uid: 'collection-1',
    name: 'Shared collection',
    parentId: 'folder-1',
    tabs: [],
    chromeGroups: [],
    lastUpdated: Date.now(),
};

const renderPanel = async (folders, store) => {
    await act(async () => {
        render(
            <Provider store={store}>
                <CollectionDetailPanel
                    collection={collection}
                    isOpen={true}
                    onClose={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                    renderInline={true}
                    folders={folders}
                />
            </Provider>,
        );
    });
};

describe('a delete attempt on a shared-folder collection is blocked at the real component (CollectionDetailPanel)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        storageUtils.loadAllCollections.mockResolvedValue([]);
    });

    test('opens the no-permission modal and never deletes when the parent folder is read-only shared', async () => {
        const store = createStore();
        await renderPanel([READ_ONLY_FOLDER], store);

        fireEvent.click(document.querySelector('.panel-action-btn.danger'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Collection' }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(storageUtils.deleteSingleCollection).not.toHaveBeenCalled();
        expect(toastHelpers.showUndoToast).not.toHaveBeenCalled();
        expect(store.get(noPermissionOpenState)).toBe(true);
    });

    test('deletes normally when the parent folder is writable', async () => {
        const store = createStore();
        await renderPanel([WRITABLE_FOLDER], store);

        fireEvent.click(document.querySelector('.panel-action-btn.danger'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Collection' }));

        // _handleDelete defers the actual deletion behind a 400ms animation timeout.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 450));
        });

        expect(storageUtils.deleteSingleCollection).toHaveBeenCalledWith('collection-1');
        expect(store.get(noPermissionOpenState)).toBe(false);
    });
});
