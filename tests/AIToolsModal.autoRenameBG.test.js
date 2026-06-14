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
// the service worker writing aiTaskState progress.
let storageListener;

const fireStorageChange = async (newValue) => {
    await act(async () => {
        storageListener({ aiTaskState: { newValue } }, 'local');
    });
};

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

describe('AIToolsModal – Auto-Rename driven by the service worker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        loadAllCollections.mockResolvedValue([{ ...C1 }, { ...C2 }, { ...C_EMPTY }]);
        getAIAvailability.mockResolvedValue('available');

        // aiGetState → null initially; capture aiRun calls
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            return Promise.resolve({});
        });
        storageListener = undefined;
        browser.storage.onChanged.addListener = jest.fn((fn) => { storageListener = fn; });
        browser.storage.onChanged.removeListener = jest.fn();
    });

    test('clicking Run dispatches aiRun(auto-rename) with target uids', async () => {
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await waitFor(() => {
            const runCall = browser.runtime.sendMessage.mock.calls.find((c) => c[0].type === 'aiRun');
            expect(runCall).toBeTruthy();
            expect(runCall[0].task).toBe('auto-rename');
            expect(runCall[0].params.uids).toEqual(['c1', 'c2']); // c3 empty excluded
        });
    });

    test('selected scope limits the dispatched uids', async () => {
        await renderOpenModal({ scope: { type: 'selected', uids: ['c2'] } });
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename 1/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename 1/i }));
        });

        await waitFor(() => {
            const runCall = browser.runtime.sendMessage.mock.calls.find((c) => c[0].type === 'aiRun');
            expect(runCall[0].params.uids).toEqual(['c2']);
        });
    });

    test('running aiTaskState change sets processing uids and renders results live', async () => {
        const store = await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        // Processing uids set synchronously on Run
        await waitFor(() => expect(store.get(aiProcessingUidsState)).toEqual(['c1', 'c2']));

        // SW reports progress on c1
        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'running',
            filed: 0, total: 2, currentLabel: 'Untitled', currentUid: 'c1',
            results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }], skipped: [],
        });

        expect(store.get(aiProcessingCurrentUidState)).toBe('c1');
        expect(screen.getByText('React Learning')).toBeInTheDocument();
    });

    test('done aiTaskState change renders summary/results, clears atoms, fires toast once', async () => {
        const store = await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        const doneState = {
            taskId: 't1', type: 'auto-rename', status: 'done',
            filed: 1, total: 1,
            results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }],
            skipped: [],
            summary: 'Renamed 1 collection with AI',
        };
        await fireStorageChange(doneState);

        // Result row rendered
        expect(screen.getByText(/Untitled/)).toBeInTheDocument();
        expect(screen.getByText('React Learning')).toBeInTheDocument();

        // Atoms cleared
        expect(store.get(aiProcessingUidsState)).toEqual([]);
        expect(store.get(aiProcessingCurrentUidState)).toBeNull();

        // Undo toast fired once, with summary + undo action that sends aiUndo
        expect(showUndoToast).toHaveBeenCalledTimes(1);
        const [, message, title, undoFn] = showUndoToast.mock.calls[0];
        expect(message).toBe('Renamed 1 collection with AI');
        expect(title).toBe('Tabox AI');
        await act(async () => { await undoFn(); });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aiUndo' });

        // A second identical done change must NOT re-fire the toast
        await fireStorageChange(doneState);
        expect(showUndoToast).toHaveBeenCalledTimes(1);
    });

    test('cancel button sends aiCancel', async () => {
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        // Enter running state via SW change
        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'running', filed: 0, total: 2,
            currentUid: 'c1', currentLabel: 'Untitled', results: [], skipped: [],
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        });

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aiCancel' });
    });

    test('cancelled status shows the cancel note', async () => {
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await fireStorageChange({
            taskId: 't1', type: 'auto-rename', status: 'cancelled',
            filed: 0, total: 2, results: [], skipped: [],
        });

        expect(screen.getByText(/cancelled — no changes made/i)).toBeInTheDocument();
        expect(showUndoToast).not.toHaveBeenCalled();
    });

    test('error status shows the error and no toast', async () => {
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

        expect(screen.getByText(/unexpected error/i)).toBeInTheDocument();
        expect(showUndoToast).not.toHaveBeenCalled();
    });

    test('pre-flight failure shows error and does not dispatch aiRun', async () => {
        getAIAvailability.mockResolvedValue('downloadable');
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        await waitFor(() => screen.getByRole('button', { name: /auto-rename/i }));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /auto-rename/i }));
        });

        await waitFor(() => expect(screen.getByText(/tabox ai is not ready/i)).toBeInTheDocument());
        expect(browser.runtime.sendMessage.mock.calls.find((c) => c[0].type === 'aiRun')).toBeUndefined();
    });

    test('reopened popup re-attaches to an in-progress run via aiGetState', async () => {
        // aiGetState returns a running auto-rename task
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') {
                return Promise.resolve({
                    taskId: 't9', type: 'auto-rename', status: 'running',
                    filed: 1, total: 3, currentUid: 'c2', currentLabel: 'Old News',
                    results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }], skipped: [],
                });
            }
            return Promise.resolve({});
        });

        const store = await renderOpenModal();

        // Reattach auto-navigates to the auto-rename panel; the in-progress
        // result renders without clicking the tool card or Run.
        await waitFor(() => expect(screen.getByText('React Learning')).toBeInTheDocument());
        // The AI-border atom is restored to the running currentUid so the
        // processed collection keeps its highlight after reattach.
        expect(store.get(aiProcessingCurrentUidState)).toBe('c2');
    });

    test('reopening after a finished run does not re-toast and leaves the panel idle', async () => {
        // aiGetState returns a TERMINAL done state from a prior session.
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') {
                return Promise.resolve({
                    taskId: 't-old', type: 'auto-rename', status: 'done',
                    filed: 1, total: 1,
                    results: [{ uid: 'c1', oldName: 'Untitled', newName: 'React Learning' }],
                    skipped: [], summary: 'Renamed 1 collection with AI',
                });
            }
            return Promise.resolve({});
        });

        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));

        // The idle run button is shown — not the done summary — and no toast fires.
        await waitFor(() => expect(screen.getByRole('button', { name: /auto-rename/i })).toBeInTheDocument());
        expect(screen.queryByText('React Learning')).not.toBeInTheDocument();
        expect(showUndoToast).not.toHaveBeenCalled();
    });

    test('reopening during a running task reattaches and shows progress', async () => {
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') {
                return Promise.resolve({
                    taskId: 't-run', type: 'auto-rename', status: 'running',
                    filed: 1, total: 3, currentUid: 'c2', currentLabel: 'X',
                    results: [], skipped: [],
                });
            }
            return Promise.resolve({});
        });

        await renderOpenModal();

        // Reattach auto-navigates to the auto-rename panel; the progress label
        // reflects the running state (2 of 3: X) without clicking the tool card.
        await waitFor(() => expect(screen.getByText(/Renaming 2 of 3: X/)).toBeInTheDocument());
    });
});
