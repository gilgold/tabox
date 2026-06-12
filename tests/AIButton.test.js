/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import { browser } from '../static/globals';
import AIButton from '../app/AIButton';

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
        render(<Provider><AIButton /></Provider>);
        await waitFor(() => expect(screen.getByRole('button', { name: /tabox ai/i })).toBeInTheDocument());
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
});
