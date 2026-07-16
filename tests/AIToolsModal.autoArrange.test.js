/** @jest-environment jsdom */
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn().mockResolvedValue('available'),
}));
jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    showSuccessToast: jest.fn(),
}));
jest.mock('../app/ai/useSmartOrganizeUndo', () => ({
    useSmartOrganizeUndo: () => ({ snapshot: null, undo: jest.fn() }),
}));

import '@testing-library/jest-dom';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import AIToolsModal from '../app/AIToolsModal';
import { aiToolsModalOpenState, aiToolsScopeState } from '../app/atoms/aiState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const PRO = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };
import { loadAllCollections } from '../app/utils/storageUtils';
import { showUndoToast } from '../app/toastHelpers';
import { browser } from '../static/globals';

// Captured storage.onChanged listener(s) so tests can simulate the SW writing
// aiTaskState. The modal AND useAutoArrangeUndo each register a listener; fan
// the change out to all of them.
let storageListeners;

const fireStorageChange = async (newValue) => {
    await act(async () => {
        storageListeners.forEach((fn) => fn({ aiTaskState: { newValue } }, 'local'));
    });
};

const DONE_STATE = {
    taskId: 't1',
    type: 'auto-arrange',
    status: 'done',
    filed: 3,
    total: 3,
    summary: 'Filed 3 collections into folders · created 2 new folders',
    undo: { task: 'auto-arrange', moves: [], createdFolderUids: ['nf1', 'nf2'] },
};

function renderModal() {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    store.set(aiToolsScopeState, { type: 'all' });
    store.set(premiumEntitlementState, PRO);
    return render(
        <Provider store={store}>
            <AIToolsModal updateRemoteData={jest.fn()} />
        </Provider>
    );
}

const openArrangePanel = async () => {
    await waitFor(() => expect(screen.getByRole('button', { name: /Auto-arrange into folders/i })).not.toBeDisabled());
    const card = screen.getByRole('button', { name: /Auto-arrange into folders/i });
    await act(async () => { fireEvent.click(card); });
    return screen.findByRole('button', { name: /Arrange now/i });
};

beforeEach(() => {
    jest.clearAllMocks();
    loadAllCollections.mockResolvedValue([
        { uid: 'c1', name: 'A', parentId: null, tabs: [{ title: 't' }] },
        { uid: 'c2', name: 'B', parentId: null, tabs: [{ title: 'u' }] },
        { uid: 'c3', name: 'C', parentId: null, tabs: [{ title: 'v' }] },
    ]);
    storageListeners = [];
    browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
        if (msg.type === 'aiGetState') return Promise.resolve(null);
        return Promise.resolve({});
    });
    browser.storage.onChanged.addListener = jest.fn((fn) => { storageListeners.push(fn); });
    browser.storage.onChanged.removeListener = jest.fn((fn) => {
        storageListeners = storageListeners.filter((f) => f !== fn);
    });
});

test('auto-arrange card is disabled when there are no root collections', async () => {
    loadAllCollections.mockResolvedValue([
        { uid: 'c1', name: 'A', parentId: 'f1', tabs: [{ title: 't' }] },
    ]);
    renderModal();
    const card = await screen.findByRole('button', { name: /Auto-arrange into folders/i });
    expect(card).toBeDisabled();
});

test('clicking Arrange now dispatches aiRun(auto-arrange) with empty params', async () => {
    renderModal();
    const arrangeBtn = await openArrangePanel();

    await act(async () => { fireEvent.click(arrangeBtn); });

    await waitFor(() => {
        const runCall = browser.runtime.sendMessage.mock.calls.find((c) => c[0].type === 'aiRun');
        expect(runCall).toBeTruthy();
        expect(runCall[0]).toEqual({ type: 'aiRun', task: 'auto-arrange', params: {} });
    });
});

test('a done aiTaskState change renders the summary and fires the undo toast', async () => {
    renderModal();
    const arrangeBtn = await openArrangePanel();
    await act(async () => { fireEvent.click(arrangeBtn); });

    await fireStorageChange(DONE_STATE);

    await screen.findByText(/Filed 3 collections/i);

    expect(showUndoToast).toHaveBeenCalledTimes(1);
    const [, message, title, undoFn] = showUndoToast.mock.calls[0];
    expect(message).toBe('Arranged collections into folders');
    expect(title).toBe('Tabox AI');
    await act(async () => { await undoFn(); });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aiUndo' });
});

test('the done-panel Undo button sends aiUndo', async () => {
    renderModal();
    const arrangeBtn = await openArrangePanel();
    await act(async () => { fireEvent.click(arrangeBtn); });
    await fireStorageChange(DONE_STATE);

    const undoBtn = await screen.findByRole('button', { name: /^Undo$/i });
    await act(async () => { fireEvent.click(undoBtn); });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aiUndo' });
});

test('persistent "Undo last arrange" button appears for a done auto-arrange and sends aiUndo', async () => {
    renderModal();
    await openArrangePanel();

    // No undo affordance before any run.
    expect(screen.queryByRole('button', { name: /Undo last arrange/i })).not.toBeInTheDocument();

    // The SW writes a completed auto-arrange — both the modal effect (done panel)
    // and useAutoArrangeUndo pick it up. Returning to idle then surfaces the
    // persistent button; here we assert it appears once the snapshot is set.
    await fireStorageChange(DONE_STATE);

    // Click "Undo" from the done panel returns to idle; the persistent affordance
    // is then visible because useAutoArrangeUndo still has the snapshot.
    const doneUndo = await screen.findByRole('button', { name: /^Undo$/i });
    await act(async () => { fireEvent.click(doneUndo); });

    const persistent = await screen.findByRole('button', { name: /Undo last arrange/i });
    browser.runtime.sendMessage.mockClear();
    await act(async () => { fireEvent.click(persistent); });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aiUndo' });
});

test('reopening while an auto-arrange is running shows the running panel (reattach)', async () => {
    // aiGetState returns a RUNNING auto-arrange state from the SW.
    browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
        if (msg.type === 'aiGetState') {
            return Promise.resolve({
                taskId: 't-run', type: 'auto-arrange', status: 'running',
                filed: 1, total: 3,
            });
        }
        return Promise.resolve({});
    });

    renderModal();

    // Without clicking the auto-arrange card, the running panel is shown:
    // the determinate "Filing … collections…" progress label appears, proving
    // activeToolId was auto-selected on reattach.
    await waitFor(() => expect(screen.getByText(/Filing .* collections?…/i)).toBeInTheDocument());
    // No tool-hub card is rendered while the running panel is active.
    expect(screen.queryByRole('button', { name: /Arrange now/i })).not.toBeInTheDocument();
});

test('reopening after a done run does not re-toast (only running tasks reattach)', async () => {
    // aiGetState returns a terminal done state from a prior session.
    browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
        if (msg.type === 'aiGetState') return Promise.resolve(DONE_STATE);
        return Promise.resolve({});
    });

    renderModal();
    await openArrangePanel();

    // Idle "Arrange now" button shown — not the done summary — and no toast.
    expect(screen.getByRole('button', { name: /Arrange now/i })).toBeInTheDocument();
    expect(screen.queryByText(/Filed 3 collections/i)).not.toBeInTheDocument();
    expect(showUndoToast).not.toHaveBeenCalled();
});
