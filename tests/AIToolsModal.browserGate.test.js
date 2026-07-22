/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn().mockResolvedValue('unsupported-browser'),
    isAISupported: jest.fn().mockReturnValue(false),
}));
jest.mock('../app/ai/browserSupport', () => ({
    isChromeBrowser: jest.fn().mockReturnValue(false),
    getBrowserName: jest.fn().mockReturnValue('Microsoft Edge'),
}));
jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    loadAllCollections: jest.fn().mockResolvedValue([]),
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

import { browser } from '../static/globals';
import AIToolsModal from '../app/AIToolsModal';
import { aiToolsModalOpenState, aiToolsInitialToolState } from '../app/atoms/aiState';

function renderModal({ initialTool = null } = {}) {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    if (initialTool) store.set(aiToolsInitialToolState, initialTool);
    render(<Provider store={store}><AIToolsModal /></Provider>);
    return store;
}

describe('AIToolsModal Chrome-only browser gate', () => {
    beforeEach(() => {
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            return Promise.resolve({});
        });
        browser.storage.local.get = jest.fn().mockResolvedValue({});
    });

    test('shows the Chrome-only notice instead of the tools list', async () => {
        renderModal();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Tabox AI is only available on Google Chrome',
        );
        expect(screen.getByRole('alert')).toHaveTextContent(/Microsoft Edge/);
        expect(screen.queryByText('Smart Tab Grouping')).not.toBeInTheDocument();
    });

    test('shows the notice even when opened pre-navigated to a tool (command palette path)', async () => {
        renderModal({ initialTool: 'auto-rename' });
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Tabox AI is only available on Google Chrome',
        );
    });
});
