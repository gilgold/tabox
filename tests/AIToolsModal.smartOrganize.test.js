/** @jest-environment jsdom */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState } from '../app/atoms/aiState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const PRO = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };

jest.mock('../app/utils/storageUtils', () => ({ loadAllCollections: jest.fn().mockResolvedValue([]) }));
jest.mock('../app/ai/readWindowStructure', () => ({ readWindowStructure: jest.fn().mockResolvedValue({ ungroupedTabs: [], existingGroups: [], eligibleCount: 0 }) }));
jest.mock('../app/ai/aiClient', () => ({ getAIAvailability: jest.fn().mockResolvedValue('available') }));
jest.mock('../app/toastHelpers', () => ({ showUndoToast: jest.fn(), showSuccessToast: jest.fn() }));
jest.mock('../app/ai/captureWindowSnapshot', () => ({ captureWindowSnapshot: jest.fn() }));
jest.mock('../app/ai/useSmartOrganizeUndo', () => ({ useSmartOrganizeUndo: jest.fn() }));

import AIToolsModal from '../app/AIToolsModal';
import { readWindowStructure } from '../app/ai/readWindowStructure';
import { showUndoToast } from '../app/toastHelpers';
import { browser } from '../static/globals';
import { captureWindowSnapshot } from '../app/ai/captureWindowSnapshot';
import { loadAllCollections } from '../app/utils/storageUtils';
import { useSmartOrganizeUndo } from '../app/ai/useSmartOrganizeUndo';

// Captured storage.onChanged listener(s) so tests can simulate the SW writing
// aiTaskState. The modal (and any undo hooks) register listeners; fan changes
// out to all of them.
let storageListeners;

const fireStorageChange = async (newValue) => {
    await act(async () => {
        storageListeners.forEach((fn) => fn({ aiTaskState: { newValue } }, 'local'));
    });
};

// The plan the SW writes into aiTaskState.results for a finished planning run.
const PLAN = { newGroups: [{ name: 'Docs', color: 'blue', tabIds: [1, 2] }], additions: [], skippedTabIds: [] };
const donePlanState = (taskId = 'so1', results = PLAN) => ({ taskId, type: 'smart-organize', status: 'done', results });

// Default: no persistent undo snapshot
beforeEach(() => {
    useSmartOrganizeUndo.mockReturnValue({ snapshot: null, undo: jest.fn().mockResolvedValue(undefined), dismiss: jest.fn() });
    storageListeners = [];
    browser.storage.onChanged.addListener = jest.fn((fn) => { storageListeners.push(fn); });
    browser.storage.onChanged.removeListener = jest.fn((fn) => {
        storageListeners = storageListeners.filter((f) => f !== fn);
    });
});

const openModal = async () => {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    store.set(premiumEntitlementState, PRO);
    await act(async () => {
        render(<Provider store={store}><AIToolsModal updateRemoteData={jest.fn()} /></Provider>);
    });
    return store;
};

test('renders Smart Organize as a featured hero card', async () => {
    browser.runtime.sendMessage = jest.fn().mockResolvedValue(null);
    await openModal();
    expect(screen.getByText('Smart Tab Grouping')).toBeInTheDocument();
    expect(document.querySelector('.ai-hero-card')).toBeInTheDocument();
});

describe('Smart Organize panel (popup)', () => {
    beforeEach(() => {
        browser.windows.getCurrent = jest.fn().mockResolvedValue({ id: 100 });
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            if (msg.type === 'smartOrganizeApply') return Promise.resolve({ success: true, groupsCreated: 2, tabsAdded: 5, skipped: 0 });
            return Promise.resolve({});
        });
        readWindowStructure.mockResolvedValue({
            ungroupedTabs: [{ tabId: 1, title: 'A', url: 'https://a.com' }, { tabId: 2, title: 'B', url: 'https://b.com' }],
            existingGroups: [], eligibleCount: 2,
        });
    });

    test('clicking organize dispatches aiRun(smart-organize) with the windowId', async () => {
        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });

        await waitFor(() => {
            const runCall = browser.runtime.sendMessage.mock.calls.find((c) => c[0].type === 'aiRun');
            expect(runCall).toBeTruthy();
            expect(runCall[0]).toEqual({ type: 'aiRun', task: 'smart-organize', params: { windowId: 100 } });
        });
    });

    test('shows determinate service-worker progress while organizing tabs', async () => {
        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });
        await fireStorageChange({
            taskId: 'so-progress',
            type: 'smart-organize',
            status: 'running',
            progress: 35,
            currentLabel: 'Step 2 of 3: Asking AI to group tabs…',
        });

        const progressBar = screen.getByRole('progressbar', { name: /smart tab grouping progress/i });
        expect(progressBar).toHaveAttribute('aria-valuenow', '35');
        expect(progressBar.querySelector('.ai-rename-progress-fill')).toHaveStyle({ width: '35%' });
        expect(screen.getByText('Step 2 of 3: Asking AI to group tabs…')).toBeInTheDocument();
    });

    test('a done plan state applies the plan, renders the summary, and fires the undo toast', async () => {
        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });
        await waitFor(() => expect(browser.runtime.sendMessage.mock.calls.some((c) => c[0].type === 'aiRun')).toBe(true));

        await fireStorageChange(donePlanState());

        await waitFor(() => {
            const applyCall = browser.runtime.sendMessage.mock.calls.find((c) => c[0].type === 'smartOrganizeApply');
            expect(applyCall).toBeTruthy();
            expect(applyCall[0]).toMatchObject({ type: 'smartOrganizeApply', windowId: 100, plan: PLAN });
        });

        await waitFor(() => expect(showUndoToast).toHaveBeenCalled());
        expect(screen.getByLabelText('2 new groups')).toBeInTheDocument();
    });

    test('done state presents the grouped result as metric cards without a duplicate close action', async () => {
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            if (msg.type === 'smartOrganizeApply') {
                return Promise.resolve({ success: true, groupsCreated: 7, tabsAdded: 11, skipped: 13 });
            }
            return Promise.resolve({});
        });

        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });
        await fireStorageChange(donePlanState());

        await waitFor(() => expect(screen.getByRole('status', { name: 'Your tabs are grouped' })).toBeInTheDocument());
        expect(screen.getByLabelText('7 new groups')).toBeInTheDocument();
        expect(screen.getByLabelText('11 added to groups')).toBeInTheDocument();
        expect(screen.getByLabelText('13 left ungrouped')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save as collection' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

        const closeButtons = screen.getAllByRole('button', { name: 'Close' });
        expect(closeButtons).toHaveLength(1);
        expect(closeButtons[0]).toHaveClass('ai-tools-modal-close');
    });

    test('the undo toast action sends smartOrganizeUndo', async () => {
        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });

        await fireStorageChange(donePlanState());
        await waitFor(() => expect(showUndoToast).toHaveBeenCalled());

        const undoFn = showUndoToast.mock.calls[0][3];
        browser.runtime.sendMessage.mockClear();
        await act(async () => { await undoFn(); });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'smartOrganizeUndo', windowId: 100 });
    });

    test('applies the plan only once even if the done state re-renders', async () => {
        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });

        await fireStorageChange(donePlanState('so1'));
        await fireStorageChange(donePlanState('so1'));

        await waitFor(() => expect(screen.getByLabelText('2 new groups')).toBeInTheDocument());
        const applyCalls = browser.runtime.sendMessage.mock.calls.filter((c) => c[0].type === 'smartOrganizeApply');
        expect(applyCalls).toHaveLength(1);
    });

    test('disables run when there are no ungrouped tabs', async () => {
        readWindowStructure.mockResolvedValue({ ungroupedTabs: [], existingGroups: [], eligibleCount: 0 });
        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/already grouped/i)).toBeInTheDocument());
    });

    test('"Save as collection" calls captureWindowSnapshot and persists grouped tabs', async () => {
        const updateRemoteData = jest.fn().mockResolvedValue(undefined);
        captureWindowSnapshot.mockResolvedValue({
            tabs: [
                { id: 1, url: 'https://a.com', title: 'A', groupId: 10 },
                { id: 2, url: 'https://b.com', title: 'B', groupId: 10 },
                { id: 3, url: 'https://c.com', title: 'C', groupId: -1 },
            ],
            chromeGroups: [{ id: 10, title: 'Work', color: 'blue' }],
        });
        loadAllCollections.mockResolvedValue([]);

        const store = createStore();
        store.set(aiToolsModalOpenState, true);
        store.set(premiumEntitlementState, PRO);
        await act(async () => {
            render(<Provider store={store}><AIToolsModal updateRemoteData={updateRemoteData} /></Provider>);
        });

        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });
        await fireStorageChange(donePlanState());
        await waitFor(() => expect(screen.getByText(/save as collection/i)).toBeInTheDocument());

        fireEvent.click(screen.getByText(/save as collection/i));

        await waitFor(() => expect(captureWindowSnapshot).toHaveBeenCalledWith(100));
        await waitFor(() => expect(updateRemoteData).toHaveBeenCalled());

        const [[savedCollections]] = updateRemoteData.mock.calls;
        const savedCollection = savedCollections[savedCollections.length - 1];
        expect(savedCollection.tabs.some((t) => t.groupId === 10)).toBe(true);
        expect(savedCollection.chromeGroups).toHaveLength(1);
        expect(savedCollection.chromeGroups[0].id).toBe(10);
    });

    test('shows an error and returns to idle when smartOrganizeApply fails', async () => {
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            if (msg.type === 'smartOrganizeApply') return Promise.reject(new Error('apply boom'));
            return Promise.resolve({});
        });

        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });
        await waitFor(() => expect(browser.runtime.sendMessage.mock.calls.some((c) => c[0].type === 'aiRun')).toBe(true));

        await fireStorageChange(donePlanState());

        // apply was attempted but rejected
        await waitFor(() => expect(browser.runtime.sendMessage.mock.calls.some((c) => c[0].type === 'smartOrganizeApply')).toBe(true));
        await waitFor(() => expect(screen.getByText(/could not apply the grouping/i)).toBeInTheDocument());
        // panel back to idle: the run button is available again
        await waitFor(() => expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument());
    });

    test('shows an error when the smart-organize plan fails in the SW', async () => {
        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });
        await waitFor(() => expect(browser.runtime.sendMessage.mock.calls.some((c) => c[0].type === 'aiRun')).toBe(true));

        browser.runtime.sendMessage.mockClear();
        await fireStorageChange({ taskId: 'so-err', type: 'smart-organize', status: 'error', summary: 'planning failed' });

        await waitFor(() => expect(screen.getByText(/an unexpected error occurred/i)).toBeInTheDocument());
        // panel back to idle: the run button is available again
        await waitFor(() => expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument());
        // no apply was dispatched for an SW-error plan
        expect(browser.runtime.sendMessage.mock.calls.some((c) => c[0].type === 'smartOrganizeApply')).toBe(false);
    });

    test('reopening while planning is running shows the running panel (reattach)', async () => {
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') {
                return Promise.resolve({ taskId: 'so-run', type: 'smart-organize', status: 'running' });
            }
            return Promise.resolve({});
        });

        await openModal();

        // The running panel renders without clicking the card: the "Organizing tabs…"
        // label proves activeToolId auto-selected to smart-organize on reattach.
        await waitFor(() => expect(screen.getByText(/Organizing tabs…/i)).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /organize now/i })).not.toBeInTheDocument();
    });
});

describe('Smart Organize — in-modal undo affordance', () => {
    beforeEach(() => {
        browser.windows.getCurrent = jest.fn().mockResolvedValue({ id: 100 });
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            if (msg.type === 'smartOrganizeApply') return Promise.resolve({ success: true, groupsCreated: 2, tabsAdded: 3, skipped: 0 });
            return Promise.resolve({});
        });
        readWindowStructure.mockResolvedValue({
            ungroupedTabs: [{ tabId: 1, title: 'A', url: 'https://a.com' }],
            existingGroups: [], eligibleCount: 1,
        });
    });

    test('done-state Undo calls undo message and transitions panel back to idle, clearing the summary', async () => {
        const undoFn = jest.fn().mockResolvedValue(undefined);
        useSmartOrganizeUndo.mockReturnValue({ snapshot: null, undo: undoFn, dismiss: jest.fn() });

        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /organize/i })); });
        await fireStorageChange(donePlanState());
        await waitFor(() => expect(screen.getByLabelText('2 new groups')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));

        await waitFor(() => expect(undoFn).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByLabelText('2 new groups')).not.toBeInTheDocument());
        await waitFor(() => expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument());
    });

    test('idle state shows "Undo last organize" row when a persistent snapshot exists', async () => {
        const undoFn = jest.fn().mockResolvedValue(undefined);
        useSmartOrganizeUndo.mockReturnValue({
            snapshot: { windowId: 100, createdAt: Date.now() },
            undo: undoFn,
            dismiss: jest.fn(),
        });

        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByText(/undo last organize/i)).toBeInTheDocument());

        fireEvent.click(screen.getByText(/undo last organize/i));

        await waitFor(() => expect(undoFn).toHaveBeenCalled());
    });

    test('idle state does not show "Undo last organize" when no snapshot', async () => {
        useSmartOrganizeUndo.mockReturnValue({ snapshot: null, undo: jest.fn(), dismiss: jest.fn() });

        await openModal();
        fireEvent.click(screen.getByText('Smart Tab Grouping'));
        await waitFor(() => expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument());

        expect(screen.queryByText(/undo last organize/i)).not.toBeInTheDocument();
    });
});
