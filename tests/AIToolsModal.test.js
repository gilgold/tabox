/** @jest-environment jsdom */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState, aiToolsScopeState, aiProcessingUidsState, aiProcessingCurrentUidState } from '../app/atoms/aiState';

jest.mock('../app/ai/tasks/autoRenameCollections', () => ({
    autoRenameCollections: jest.fn(),
}));
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
    isAISupported: jest.fn().mockReturnValue(true),
}));
jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    loadAllCollections: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    showSuccessToast: jest.fn(),
}));

import { autoRenameCollections } from '../app/ai/tasks/autoRenameCollections';
import { getAIAvailability } from '../app/ai/aiClient';
import { loadAllCollections } from '../app/utils/storageUtils';
import { showUndoToast } from '../app/toastHelpers';
import AIToolsModal from '../app/AIToolsModal';

const C1 = { uid: 'c1', name: 'Untitled', tabs: [{ title: 'React Docs', url: 'https://react.dev' }] };
const C2 = { uid: 'c2', name: 'Old News', tabs: [{ title: 'BBC News', url: 'https://bbc.com' }] };
const C_EMPTY = { uid: 'c3', name: 'Empty', tabs: [] };

const renderOpenModal = async ({ updateRemoteData = jest.fn(), scope = { type: 'all' } } = {}) => {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    store.set(aiToolsScopeState, scope);
    await act(async () => {
        render(
            <Provider store={store}>
                <AIToolsModal updateRemoteData={updateRemoteData} />
            </Provider>
        );
    });
    return store;
};

describe('AIToolsModal', () => {
    beforeEach(() => {
        loadAllCollections.mockResolvedValue([{ ...C1 }, { ...C2 }, { ...C_EMPTY }]);
        getAIAvailability.mockResolvedValue('available');
        autoRenameCollections.mockReset();
        showUndoToast.mockReset();
    });

    // ── 1. Tool list ─────────────────────────────────────────────────────────

    test('tool list renders from registry', async () => {
        await renderOpenModal();
        expect(screen.getByText('Auto-name collection')).toBeInTheDocument();
    });

    // ── 2. Idle panel shows count ─────────────────────────────────────────────

    test('idle panel shows nameable count (empty collection excluded)', async () => {
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        // 2 nameable out of 3 loaded (C_EMPTY excluded) — button has the count
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename 2/i })).toBeInTheDocument());
        // Description also mentions 2 collections
        expect(screen.getByText(/automatically rename 2 collections/i)).toBeInTheDocument();
    });

    test('idle panel singular copy when 1 collection', async () => {
        loadAllCollections.mockResolvedValue([{ ...C1 }]);
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename 1 collection$/i })).toBeInTheDocument());
    });

    test('action button disabled when no nameable collections', async () => {
        loadAllCollections.mockResolvedValue([{ ...C_EMPTY }]);
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename/i })).toBeDisabled());
        expect(screen.getByText(/no collections with tabs/i)).toBeInTheDocument();
    });

    // ── 3. One-click run ──────────────────────────────────────────────────────

    test('run calls engine with nameable targets; updateRemoteData patched once; done summary shown', async () => {
        // Engine returns rename for c1, skip for c2
        autoRenameCollections.mockImplementation(async ({ onResult }) => {
            onResult({ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' });
            return { results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }], skipped: [], cancelled: false };
        });

        // fresh collections returned after run
        loadAllCollections
            .mockResolvedValueOnce([{ ...C1 }, { ...C2 }, { ...C_EMPTY }]) // open-time load
            .mockResolvedValueOnce([{ ...C1 }, { ...C2 }, { ...C_EMPTY }]); // apply-time load

        const updateRemoteData = jest.fn().mockResolvedValue(undefined);
        await renderOpenModal({ updateRemoteData });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename/i })).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        // engine called with correct targets (c1 and c2, not c3 which is empty)
        await waitFor(() => expect(autoRenameCollections).toHaveBeenCalledTimes(1));
        const engineArg = autoRenameCollections.mock.calls[0][0];
        expect(engineArg.collections.map((c) => c.uid)).toEqual(['c1', 'c2']);

        // updateRemoteData called ONCE with patched array
        await waitFor(() => expect(updateRemoteData).toHaveBeenCalledTimes(1));
        const patched = updateRemoteData.mock.calls[0][0];
        const patchedC1 = patched.find((c) => c.uid === 'c1');
        const patchedC2 = patched.find((c) => c.uid === 'c2');
        expect(patchedC1.name).toBe('React Learning');
        expect(patchedC2.name).toBe('Old News'); // unchanged
        expect(patchedC1.lastUpdated).toBeDefined();

        // undo toast fired
        expect(showUndoToast).toHaveBeenCalledTimes(1);

        // done summary: old → new row
        await waitFor(() => expect(screen.getByText(/Untitled/)).toBeInTheDocument());
        expect(screen.getByText(/React Learning/)).toBeInTheDocument();
    });

    // ── 4. Scope 'selected' limits targets ───────────────────────────────────

    test('scope selected limits engine targets to the given uids', async () => {
        autoRenameCollections.mockResolvedValue({ results: [], skipped: [], cancelled: false });
        const updateRemoteData = jest.fn().mockResolvedValue(undefined);
        await renderOpenModal({ updateRemoteData, scope: { type: 'selected', uids: ['c2'] } });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename 1/i })).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename 1/i }));
        });

        await waitFor(() => expect(autoRenameCollections).toHaveBeenCalledTimes(1));
        const engineArg = autoRenameCollections.mock.calls[0][0];
        expect(engineArg.collections.map((c) => c.uid)).toEqual(['c2']);
    });

    test('selected scope message when no targets', async () => {
        await renderOpenModal({ scope: { type: 'selected', uids: ['c3'] } }); // c3 is empty
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename/i })).toBeDisabled());
        expect(screen.getByText(/none of the selected/i)).toBeInTheDocument();
    });

    // ── 5. Undo callback ──────────────────────────────────────────────────────

    test('undo callback reverts names via second updateRemoteData call', async () => {
        autoRenameCollections.mockImplementation(async ({ onResult }) => {
            onResult({ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' });
            return { results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }], skipped: [], cancelled: false };
        });

        // First load: open-time. Second load: apply-time. Third load: undo-time (post-rename state).
        const postRenameC1 = { ...C1, name: 'React Learning' };
        loadAllCollections
            .mockResolvedValueOnce([{ ...C1 }, { ...C2 }])
            .mockResolvedValueOnce([{ ...C1 }, { ...C2 }])
            .mockResolvedValueOnce([postRenameC1, { ...C2 }]);

        const updateRemoteData = jest.fn().mockResolvedValue(undefined);
        await renderOpenModal({ updateRemoteData });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await waitFor(() => expect(showUndoToast).toHaveBeenCalledTimes(1));

        // extract and invoke undo callback
        const undoFn = showUndoToast.mock.calls[0][3];
        await act(async () => { await undoFn(); });

        expect(updateRemoteData).toHaveBeenCalledTimes(2);
        const revertedArray = updateRemoteData.mock.calls[1][0];
        const revertedC1 = revertedArray.find((c) => c.uid === 'c1');
        expect(revertedC1.name).toBe('Untitled');
    });

    // ── 6. Pre-flight failure ─────────────────────────────────────────────────

    test('pre-flight failure shows error and does not call engine', async () => {
        getAIAvailability.mockResolvedValue('downloadable');
        const updateRemoteData = jest.fn();
        await renderOpenModal({ updateRemoteData });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await waitFor(() => expect(screen.getByText(/tabox ai is not ready/i)).toBeInTheDocument());
        expect(autoRenameCollections).not.toHaveBeenCalled();
        expect(updateRemoteData).not.toHaveBeenCalled();
    });

    // ── 7. Apply failure ──────────────────────────────────────────────────────

    test('apply failure shows error and does not fire undo toast', async () => {
        autoRenameCollections.mockImplementation(async ({ onResult }) => {
            onResult({ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' });
            return { results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }], skipped: [], cancelled: false };
        });

        loadAllCollections
            .mockResolvedValueOnce([{ ...C1 }])  // open-time
            .mockResolvedValueOnce([{ ...C1 }]); // apply-time

        const updateRemoteData = jest.fn().mockRejectedValue(new Error('save failed'));
        await renderOpenModal({ updateRemoteData });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await waitFor(() => expect(screen.getByText(/could not save/i)).toBeInTheDocument());
        expect(showUndoToast).not.toHaveBeenCalled();
    });

    // Fix 2: apply-error done state — rows shown as "not saved", cancel note honest
    test('done with apply-error shows "not saved" heading, no "applied" phrasing', async () => {
        autoRenameCollections.mockImplementation(async ({ onResult }) => {
            onResult({ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' });
            return { results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }], skipped: [], cancelled: true };
        });

        loadAllCollections
            .mockResolvedValueOnce([{ ...C1 }])
            .mockResolvedValueOnce([{ ...C1 }]);

        const updateRemoteData = jest.fn().mockRejectedValue(new Error('save failed'));
        await renderOpenModal({ updateRemoteData });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await waitFor(() => expect(screen.getByText(/could not save/i)).toBeInTheDocument());

        // Must say "not saved" and NOT say "applied above"
        expect(screen.getByText(/not saved/i)).toBeInTheDocument();
        expect(screen.queryByText(/applied above/i)).not.toBeInTheDocument();
        // The cancel note must NOT claim application
        expect(screen.queryByText(/partial results applied above/i)).not.toBeInTheDocument();
    });

    // Fix 6: cancel-applies-partial-results — cancelled=true with one result → single save + undo toast + cancel note
    test('cancel with partial results: saves partial, fires undo toast, shows cancel note', async () => {
        autoRenameCollections.mockImplementation(async ({ onResult }) => {
            onResult({ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' });
            return {
                results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }],
                skipped: [],
                cancelled: true,
            };
        });

        loadAllCollections
            .mockResolvedValueOnce([{ ...C1 }, { ...C2 }]) // open-time
            .mockResolvedValueOnce([{ ...C1 }, { ...C2 }]); // apply-time

        const updateRemoteData = jest.fn().mockResolvedValue(undefined);
        await renderOpenModal({ updateRemoteData });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        // updateRemoteData called once with the patched name
        await waitFor(() => expect(updateRemoteData).toHaveBeenCalledTimes(1));
        const patched = updateRemoteData.mock.calls[0][0];
        expect(patched.find((c) => c.uid === 'c1').name).toBe('React Learning');

        // undo toast fired
        expect(showUndoToast).toHaveBeenCalledTimes(1);

        // cancel note shown
        await waitFor(() =>
            expect(screen.getByText(/cancelled — partial results applied above/i)).toBeInTheDocument()
        );
    });

    // ── 8. AI processing atoms ────────────────────────────────────────────────

    test('sets aiProcessingUids while engine runs and clears both atoms after resolve', async () => {
        let resolveEngine;
        autoRenameCollections.mockImplementation(() => new Promise((res) => {
            resolveEngine = () => res({ results: [], skipped: [], cancelled: false });
        }));

        const store = await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        // Engine is pending — processing uids should be set to target uids (c1, c2)
        await waitFor(() => {
            const uids = store.get(aiProcessingUidsState);
            expect(uids).toContain('c1');
            expect(uids).toContain('c2');
        });

        // The engine's onProgress callback drives the current-uid atom
        const { onProgress } = autoRenameCollections.mock.calls[0][0];
        await act(async () => { onProgress(0, 2, { uid: 'c1', name: 'Untitled' }); });
        expect(store.get(aiProcessingCurrentUidState)).toBe('c1');

        // Resolve the engine
        await act(async () => { resolveEngine(); });

        // After resolve, both atoms must be cleared
        await waitFor(() => {
            expect(store.get(aiProcessingUidsState)).toEqual([]);
            expect(store.get(aiProcessingCurrentUidState)).toBeNull();
        });
    });

    test('clears aiProcessing atoms when modal is reopened (reset effect)', async () => {
        // Set atoms to a dirty state
        const store = createStore();
        store.set(aiToolsModalOpenState, false);
        store.set(aiProcessingUidsState, ['c1']);
        store.set(aiProcessingCurrentUidState, 'c1');

        await act(async () => {
            render(
                <Provider store={store}>
                    <AIToolsModal updateRemoteData={jest.fn()} />
                </Provider>
            );
        });

        // Open the modal — reset effect should clear atoms
        await act(async () => { store.set(aiToolsModalOpenState, true); });

        await waitFor(() => {
            expect(store.get(aiProcessingUidsState)).toEqual([]);
            expect(store.get(aiProcessingCurrentUidState)).toBeNull();
        });
    });

    // Fix 1: double-click Run — engine called exactly once
    test('double-click Run only starts engine once', async () => {
        let resolveAvailability;
        const availabilityPromise = new Promise((res) => { resolveAvailability = res; });
        getAIAvailability.mockReturnValue(availabilityPromise);

        autoRenameCollections.mockResolvedValue({ results: [], skipped: [], cancelled: false });

        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        // Click Run twice synchronously before availability resolves
        const runBtn = screen.getByRole('button', { name: /auto-rename/i });
        fireEvent.click(runBtn);
        fireEvent.click(runBtn);

        // Now resolve the availability check
        await act(async () => {
            resolveAvailability('available');
        });

        await waitFor(() => expect(autoRenameCollections).toHaveBeenCalledTimes(1));
    });
});
