/** @jest-environment jsdom */
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn().mockResolvedValue('available'),
}));
jest.mock('../app/ai/tasks/autoArrangeCollections', () => ({
    autoArrangeCollections: jest.fn(),
}));
jest.mock('../app/ai/autoArrangeApply', () => ({
    AUTO_ARRANGE_UNDO_KEY: 'autoArrangeUndo',
    applyAutoArrange: jest.fn(),
    undoAutoArrange: jest.fn(),
}));
jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
    loadAllFolders: jest.fn().mockResolvedValue([]),
}));
jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    showSuccessToast: jest.fn(),
}));

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import AIToolsModal from '../app/AIToolsModal';
import { aiToolsModalOpenState, aiToolsScopeState } from '../app/atoms/aiState';
import { loadAllCollections } from '../app/utils/storageUtils';
import { autoArrangeCollections } from '../app/ai/tasks/autoArrangeCollections';
import { applyAutoArrange } from '../app/ai/autoArrangeApply';

function renderModal() {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    store.set(aiToolsScopeState, { type: 'all' });
    return render(
        <Provider store={store}>
            <AIToolsModal updateRemoteData={jest.fn()} />
        </Provider>
    );
}

beforeEach(() => {
    jest.clearAllMocks();
});

test('auto-arrange card is disabled when there are no root collections', async () => {
    loadAllCollections.mockResolvedValue([
        { uid: 'c1', name: 'A', parentId: 'f1', tabs: [{ title: 't' }] },
    ]);
    renderModal();
    const card = await screen.findByRole('button', { name: /Auto-arrange into folders/i });
    expect(card).toBeDisabled();
});

test('runs the engine, applies the plan, and shows the in-modal undo button', async () => {
    loadAllCollections.mockResolvedValue([
        { uid: 'c1', name: 'A', parentId: null, tabs: [{ title: 't' }] },
        { uid: 'c2', name: 'B', parentId: null, tabs: [{ title: 'u' }] },
    ]);
    autoArrangeCollections.mockResolvedValue({
        assignments: [
            { collectionId: 'c1', existingFolderId: null, newFolderName: 'X' },
            { collectionId: 'c2', existingFolderId: null, newFolderName: 'X' },
        ],
    });
    applyAutoArrange.mockResolvedValue({
        snapshot: { moves: [], createdFolderUids: ['nf'] },
        foldersCreated: 1,
        collectionsMoved: 2,
    });

    renderModal();
    const card = await screen.findByRole('button', { name: /Auto-arrange into folders/i });
    fireEvent.click(card);

    const arrangeBtn = await screen.findByRole('button', { name: /Arrange now/i });
    fireEvent.click(arrangeBtn);

    await waitFor(() => expect(applyAutoArrange).toHaveBeenCalled());
    await screen.findByText(/Filed 2 collections/i);
    expect(screen.getByRole('button', { name: /^Undo$/i })).toBeInTheDocument();
});
