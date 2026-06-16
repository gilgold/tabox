/** @jest-environment jsdom */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import AIButton from '../app/AIButton';
import { aiToolsModalOpenState, aiToolsScopeState } from '../app/atoms/aiState';

describe('AIButton', () => {
    beforeEach(() => {
        browser.storage.local.get.mockReset();
        globalThis.LanguageModel = { availability: jest.fn() };
    });

    afterEach(() => {
        delete globalThis.LanguageModel;
    });

    test('renders when Tabox AI is enabled', async () => {
        browser.storage.local.get.mockResolvedValue({ chkTaboxAI: true });
        const { container } = render(<Provider><AIButton /></Provider>);
        await waitFor(() => expect(screen.getByRole('button', { name: /tabox ai/i })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /tabox ai/i })).toHaveClass('ai-button');
        expect(container.querySelector('.ai-button svg')).toHaveAttribute('width', '26');
        expect(container.querySelector('.ai-button svg')).toHaveAttribute('height', '26');
    });

    test('renders nothing when Tabox AI is disabled', async () => {
        browser.storage.local.get.mockResolvedValue({});
        const { container } = render(<Provider><AIButton /></Provider>);
        await waitFor(() => expect(browser.storage.local.get).toHaveBeenCalled());
        expect(container.querySelector('.ai-button')).toBeNull();
    });

    test('renders nothing when the flag is set but the Prompt API is unsupported', async () => {
        delete globalThis.LanguageModel;
        browser.storage.local.get.mockResolvedValue({ chkTaboxAI: true });
        const { container } = render(<Provider><AIButton /></Provider>);
        await waitFor(() => expect(browser.storage.local.get).toHaveBeenCalled());
        expect(container.querySelector('.ai-button')).toBeNull();
    });

    test('clicking sets scope to {type:all} and opens the modal', async () => {
        browser.storage.local.get.mockResolvedValue({ chkTaboxAI: true });
        const store = createStore();
        // pre-set a stale 'selected' scope to verify it gets reset
        store.set(aiToolsScopeState, { type: 'selected', uids: ['c1'] });

        render(
            <Provider store={store}>
                <AIButton />
            </Provider>
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /tabox ai/i })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /tabox ai/i }));

        expect(store.get(aiToolsModalOpenState)).toBe(true);
        expect(store.get(aiToolsScopeState)).toEqual({ type: 'all' });
    });
});
