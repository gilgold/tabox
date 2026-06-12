/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import FPSelectionAIButton from '../app/fullpage/FPSelectionAIButton';
import { aiToolsModalOpenState, aiToolsScopeState } from '../app/atoms/aiState';

// Mock useTaboxAIEnabled
jest.mock('../app/ai/useTaboxAIEnabled', () => ({
    useTaboxAIEnabled: jest.fn(),
}));

// Mock aiClient
jest.mock('../app/ai/aiClient', () => ({
    isAISupported: jest.fn(),
}));

import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';
import { isAISupported } from '../app/ai/aiClient';

describe('FPSelectionAIButton', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.get.mockResolvedValue({});
        useTaboxAIEnabled.mockReturnValue(true);
        isAISupported.mockReturnValue(true);
    });

    test('renders the AI button when enabled, supported, and has selection', async () => {
        render(
            <Provider>
                <FPSelectionAIButton selectedUids={['c1', 'c2']} />
            </Provider>
        );
        expect(screen.getByRole('button', { name: /AI actions for selected collections/i })).toBeInTheDocument();
    });

    test('renders nothing when useTaboxAIEnabled returns false', () => {
        useTaboxAIEnabled.mockReturnValue(false);
        const { container } = render(
            <Provider>
                <FPSelectionAIButton selectedUids={['c1']} />
            </Provider>
        );
        expect(container.querySelector('.fp-toolbar-ai-btn')).toBeNull();
    });

    test('renders nothing when isAISupported returns false', () => {
        isAISupported.mockReturnValue(false);
        const { container } = render(
            <Provider>
                <FPSelectionAIButton selectedUids={['c1']} />
            </Provider>
        );
        expect(container.querySelector('.fp-toolbar-ai-btn')).toBeNull();
    });

    test('button is disabled when selectedUids is empty', () => {
        render(
            <Provider>
                <FPSelectionAIButton selectedUids={[]} />
            </Provider>
        );
        const btn = screen.getByRole('button', { name: /AI actions for selected collections/i });
        expect(btn).toBeDisabled();
    });

    test('click sets aiToolsScopeState to selected uids and opens modal', () => {
        const store = createStore();
        // Start with scope = all to verify it changes
        store.set(aiToolsScopeState, { type: 'all' });
        store.set(aiToolsModalOpenState, false);

        render(
            <Provider store={store}>
                <FPSelectionAIButton selectedUids={['col-1', 'col-2']} />
            </Provider>
        );

        fireEvent.click(screen.getByRole('button', { name: /AI actions for selected collections/i }));

        expect(store.get(aiToolsModalOpenState)).toBe(true);
        expect(store.get(aiToolsScopeState)).toEqual({ type: 'selected', uids: ['col-1', 'col-2'] });
    });

    test('click does not clear the selection (no side effects tested via prop stability)', () => {
        const store = createStore();
        render(
            <Provider store={store}>
                <FPSelectionAIButton selectedUids={['x1']} />
            </Provider>
        );
        // Click should not throw, and button should still be in the DOM afterwards
        fireEvent.click(screen.getByRole('button', { name: /AI actions for selected collections/i }));
        expect(screen.getByRole('button', { name: /AI actions for selected collections/i })).toBeInTheDocument();
    });
});
