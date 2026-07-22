/** @jest-environment jsdom */
// The duplicate scan publishes its sweep state right after detection, before the
// AI finishes refining recommendations. The modal must switch from the scanning
// animation to the interactive panel as soon as that fresh state appears.
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState, aiToolsScopeState, aiToolsInitialToolState } from '../app/atoms/aiState';
import { premiumEntitlementState } from '../app/atoms/premiumState';

const PRO = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };

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
import { browser } from '../static/globals';
import AIToolsModal from '../app/AIToolsModal';

// Every storage.onChanged listener (aiTaskState hook + useDuplicateSweep).
let storageListeners = [];
const fireStorageChange = async (changes) => {
    await act(async () => {
        storageListeners.forEach((fn) => fn(changes, 'local'));
    });
};

const sweepState = (createdAt) => ({
    createdAt,
    scope: { type: 'all' },
    history: [],
    groups: [{
        id: 'cross:A|D', kind: 'cross', collectionUids: ['A', 'D'], status: 'pending',
        recommendation: { recommendedKeeperUid: 'D', message: 'These tabs appear in A and D.', suggestedNewCollectionName: 'Shared', bestTitlePerUrl: [] },
        urls: [{ normalizedUrl: 'x.com', occurrences: [{}, {}] }],
    }],
});

describe('AIToolsModal duplicate sweep early panel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        storageListeners = [];
        loadAllCollections.mockResolvedValue([
            { uid: 'A', name: 'Work', tabs: [{ title: 'X', url: 'https://x.com' }] },
            { uid: 'D', name: 'Reference', tabs: [{ title: 'X', url: 'https://x.com' }] },
        ]);
        getAIAvailability.mockResolvedValue('available');
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            return Promise.resolve({});
        });
        browser.storage.local.get = jest.fn(async () => ({}));
        browser.storage.onChanged.addListener = jest.fn((fn) => { storageListeners.push(fn); });
        browser.storage.onChanged.removeListener = jest.fn((fn) => { storageListeners = storageListeners.filter((l) => l !== fn); });
    });

    test('switches from the scanner to the interactive panel while the task is still running', async () => {
        const store = createStore();
        store.set(aiToolsModalOpenState, true);
        store.set(aiToolsScopeState, { type: 'all' });
        store.set(aiToolsInitialToolState, 'duplicate-sweep');
        store.set(premiumEntitlementState, PRO);

        await act(async () => {
            render(
                <Provider store={store}>
                    <AIToolsModal updateRemoteData={jest.fn()} />
                </Provider>
            );
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Scan for duplicate tabs/i }));
        });
        await fireStorageChange({ aiTaskState: { newValue: { id: 't1', type: 'duplicate-sweep', status: 'running' } } });
        expect(screen.getByText(/Scanning for duplicates/i)).toBeInTheDocument();

        // Early publish from the SW: fresh sweep state while status is still 'running'.
        await fireStorageChange({ duplicateSweep: { newValue: sweepState(Date.now() + 60000) } });
        expect(screen.queryByText(/Scanning for duplicates/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Step 1 of 1/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /End sweep/i })).toBeInTheDocument();
    });

    test('stale sweep state from an earlier run does not open the panel early', async () => {
        const store = createStore();
        store.set(aiToolsModalOpenState, true);
        store.set(aiToolsScopeState, { type: 'all' });
        store.set(aiToolsInitialToolState, 'duplicate-sweep');
        store.set(premiumEntitlementState, PRO);

        await act(async () => {
            render(
                <Provider store={store}>
                    <AIToolsModal updateRemoteData={jest.fn()} />
                </Provider>
            );
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Scan for duplicate tabs/i }));
        });
        // Old state (created long before this run started) must not flip the view.
        await fireStorageChange({ duplicateSweep: { newValue: sweepState(Date.now() - 60000) } });
        await fireStorageChange({ aiTaskState: { newValue: { id: 't1', type: 'duplicate-sweep', status: 'running' } } });
        expect(screen.getByText(/Scanning for duplicates/i)).toBeInTheDocument();
        expect(screen.queryByText(/Step 1 of 1/i)).not.toBeInTheDocument();
    });
});
