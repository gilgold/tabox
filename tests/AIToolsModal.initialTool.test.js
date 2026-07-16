/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import {
    aiToolsModalOpenState,
    aiToolsScopeState,
    aiToolsInitialToolState,
} from '../app/atoms/aiState';

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

describe('AIToolsModal initial tool routing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        loadAllCollections.mockResolvedValue([]);
        getAIAvailability.mockResolvedValue('available');
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            return Promise.resolve({});
        });
        browser.storage.onChanged.addListener = jest.fn();
        browser.storage.onChanged.removeListener = jest.fn();
    });

    test('navigates straight to the requested tool panel and clears the atom', async () => {
        const store = createStore();
        store.set(aiToolsModalOpenState, true);
        store.set(aiToolsScopeState, { type: 'all' });
        store.set(aiToolsInitialToolState, 'auto-arrange-folders');

        await act(async () => {
            render(
                <Provider store={store}>
                    <AIToolsModal updateRemoteData={jest.fn()} />
                </Provider>
            );
        });

        // The tool panel shows a "Back to tools" button; the hub does not.
        expect(await screen.findByLabelText('Back to tools')).toBeInTheDocument();
        // The atom is consumed so reopening the hub later isn't hijacked.
        expect(store.get(aiToolsInitialToolState)).toBeNull();
    });
});
