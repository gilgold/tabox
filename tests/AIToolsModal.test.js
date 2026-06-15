/** @jest-environment jsdom */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState, aiToolsScopeState, aiProcessingUidsState, aiProcessingCurrentUidState } from '../app/atoms/aiState';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
    isAISupported: jest.fn().mockReturnValue(true),
}));
jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    loadAllCollections: jest.fn(),
    loadAllFolders: jest.fn().mockResolvedValue([]),
}));
jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    showSuccessToast: jest.fn(),
}));
jest.mock('../app/ai/useSmartOrganizeUndo', () => ({
    useSmartOrganizeUndo: () => ({ snapshot: null, undo: jest.fn(), dismiss: jest.fn() }),
}));
jest.mock('../app/ai/useAutoArrangeUndo', () => ({
    useAutoArrangeUndo: () => ({ snapshot: null, undo: jest.fn(), dismiss: jest.fn() }),
}));

import { getAIAvailability } from '../app/ai/aiClient';
import { loadAllCollections } from '../app/utils/storageUtils';
import { showUndoToast } from '../app/toastHelpers';
import { browser } from '../static/globals';
import AIToolsModal from '../app/AIToolsModal';

const C1 = { uid: 'c1', name: 'Untitled', tabs: [{ title: 'React Docs', url: 'https://react.dev' }] };
const C2 = { uid: 'c2', name: 'Old News', tabs: [{ title: 'BBC News', url: 'https://bbc.com' }] };
const C_EMPTY = { uid: 'c3', name: 'Empty', tabs: [] };

// Capture the registered storage.onChanged listener so tests can simulate
// the service worker writing aiTaskState.
let storageListener;

const fireStorageChange = async (newValue) => {
    await act(async () => {
        storageListener({ aiTaskState: { newValue } }, 'local');
    });
};

const getAiRunCall = () => browser.runtime.sendMessage.mock.calls.find((c) => c[0].type === 'aiRun');

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
        jest.clearAllMocks();
        loadAllCollections.mockResolvedValue([{ ...C1 }, { ...C2 }, { ...C_EMPTY }]);
        getAIAvailability.mockResolvedValue('available');
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            return Promise.resolve({});
        });
        storageListener = undefined;
        browser.storage.onChanged.addListener = jest.fn((fn) => { storageListener = fn; });
        browser.storage.onChanged.removeListener = jest.fn();
    });

    // ── 0. Warmup ─────────────────────────────────────────────────────────────

    test('sends an aiWarmup message when the modal opens', async () => {
        await renderOpenModal();
        await waitFor(() => {
            expect(browser.runtime.sendMessage.mock.calls.some((c) => c[0].type === 'aiWarmup')).toBe(true);
        });
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

    // ── 3. One-click run dispatches to the service worker ─────────────────────

    test('run dispatches aiRun(auto-rename) with nameable targets; done change shows summary + toast', async () => {
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename/i })).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        // dispatched with correct targets (c1 and c2, not c3 which is empty)
        await waitFor(() => {
            const runCall = getAiRunCall();
            expect(runCall).toBeTruthy();
            expect(runCall[0].task).toBe('auto-rename');
            expect(runCall[0].params.uids).toEqual(['c1', 'c2']);
        });

        // SW finishes: results + summary
        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'done',
            filed: 1, total: 2,
            results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }],
            skipped: [],
            summary: 'Renamed 1 collection with AI',
        });

        // undo toast fired (SW owns apply + undo)
        expect(showUndoToast).toHaveBeenCalledTimes(1);

        // done summary: old → new row
        expect(screen.getByText(/Untitled/)).toBeInTheDocument();
        expect(screen.getByText('React Learning')).toBeInTheDocument();
    });

    // ── 4. Scope 'selected' limits targets ───────────────────────────────────

    test('scope selected limits dispatched uids to the given uids', async () => {
        await renderOpenModal({ scope: { type: 'selected', uids: ['c2'] } });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename 1/i })).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename 1/i }));
        });

        await waitFor(() => expect(getAiRunCall()[0].params.uids).toEqual(['c2']));
    });

    test('selected scope message when no targets', async () => {
        await renderOpenModal({ scope: { type: 'selected', uids: ['c3'] } }); // c3 is empty
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename/i })).toBeDisabled());
        expect(screen.getByText(/none of the selected/i)).toBeInTheDocument();
    });

    // ── 5. Undo action delegates to the service worker ────────────────────────

    test('undo toast action sends aiUndo to the service worker', async () => {
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'done',
            filed: 1, total: 1,
            results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }],
            skipped: [],
            summary: 'Renamed 1 collection with AI',
        });

        await waitFor(() => expect(showUndoToast).toHaveBeenCalledTimes(1));
        const undoFn = showUndoToast.mock.calls[0][3];
        await act(async () => { await undoFn(); });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aiUndo' });
    });

    // ── 6. Pre-flight failure ─────────────────────────────────────────────────

    test('pre-flight failure shows error and does not dispatch aiRun', async () => {
        getAIAvailability.mockResolvedValue('downloadable');
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await waitFor(() => expect(screen.getByText(/tabox ai is not ready/i)).toBeInTheDocument());
        expect(getAiRunCall()).toBeUndefined();
    });

    // ── 7. Error status ───────────────────────────────────────────────────────

    test('error status shows error and does not fire undo toast', async () => {
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'error',
            filed: 0, total: 2, results: [], skipped: [],
        });

        await waitFor(() => expect(screen.getByText(/unexpected error/i)).toBeInTheDocument());
        expect(showUndoToast).not.toHaveBeenCalled();
    });

    // cancelled with partial results → toast still fires (SW applied them), cancel note shown
    test('cancelled with partial results: fires undo toast and shows cancel note', async () => {
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'cancelled',
            filed: 1, total: 2,
            results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }],
            skipped: [],
            summary: 'Renamed 1 collection with AI',
        });

        // cancelled is not 'done' → no toast (only 'done' fires the completion toast)
        expect(showUndoToast).not.toHaveBeenCalled();
        // cancel note shown alongside partial results
        await waitFor(() =>
            expect(screen.getByText(/cancelled — partial results applied above/i)).toBeInTheDocument()
        );
    });

    // ── 8. AI processing atoms ────────────────────────────────────────────────

    test('sets aiProcessingUids on run and drives current-uid from aiTaskState; clears on done', async () => {
        const store = await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        // processing uids set to target uids (c1, c2) synchronously on run
        await waitFor(() => {
            const uids = store.get(aiProcessingUidsState);
            expect(uids).toContain('c1');
            expect(uids).toContain('c2');
        });

        // a running change drives the current-uid atom
        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'running',
            filed: 0, total: 2, currentUid: 'c1', currentLabel: 'Untitled', results: [], skipped: [],
        });
        expect(store.get(aiProcessingCurrentUidState)).toBe('c1');

        // a done change clears both atoms
        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'done',
            filed: 2, total: 2, results: [], skipped: [],
        });
        expect(store.get(aiProcessingUidsState)).toEqual([]);
        expect(store.get(aiProcessingCurrentUidState)).toBeNull();
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

    // double-click Run — aiRun dispatched exactly once
    test('double-click Run only dispatches aiRun once', async () => {
        let resolveAvailability;
        const availabilityPromise = new Promise((res) => { resolveAvailability = res; });
        getAIAvailability.mockReturnValue(availabilityPromise);

        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        // Click Run twice synchronously before availability resolves
        const runBtn = screen.getByRole('button', { name: /auto-rename/i });
        fireEvent.click(runBtn);
        fireEvent.click(runBtn);

        await act(async () => {
            resolveAvailability('available');
        });

        await waitFor(() => {
            const runCalls = browser.runtime.sendMessage.mock.calls.filter((c) => c[0].type === 'aiRun');
            expect(runCalls).toHaveLength(1);
        });
    });
});
