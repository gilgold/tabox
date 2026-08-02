/** @jest-environment jsdom */
// tests/AiSuggestNameButton.test.js
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';

jest.mock('../app/ai/useTaboxAIEnabled', () => ({ useTaboxAIEnabled: jest.fn() }));
jest.mock('../app/ai/aiClient', () => ({ isAISupported: jest.fn() }));
jest.mock('../app/toastHelpers', () => ({ showErrorToast: jest.fn() }));

import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';
import { isAISupported } from '../app/ai/aiClient';
import { showErrorToast } from '../app/toastHelpers';
import AiSuggestNameButton from '../app/AiSuggestNameButton';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { aiToolsInitialToolState, aiToolsModalOpenState } from '../app/atoms/aiState';

const renderPro = (element) => {
    const store = createStore();
    store.set(premiumEntitlementState, { entitled: true, refreshedAt: new Date().toISOString() });
    return render(<Provider store={store}>{element}</Provider>);
};

describe('AiSuggestNameButton', () => {
    beforeEach(() => {
        useTaboxAIEnabled.mockReturnValue(true);
        isAISupported.mockReturnValue(true);
        showErrorToast.mockReset();
    });

    test('renders nothing when AI is disabled', () => {
        useTaboxAIEnabled.mockReturnValue(false);
        const { container } = renderPro(<AiSuggestNameButton suggest={jest.fn()} onSuggested={jest.fn()} />);
        expect(container.querySelector('.ai-suggest-name-btn')).toBeNull();
    });

    test('renders nothing when AI is unsupported', () => {
        isAISupported.mockReturnValue(false);
        const { container } = renderPro(<AiSuggestNameButton suggest={jest.fn()} onSuggested={jest.fn()} />);
        expect(container.querySelector('.ai-suggest-name-btn')).toBeNull();
    });

    test('fills the field with the trimmed suggestion and toggles busy', async () => {
        const onSuggested = jest.fn();
        const onBusyChange = jest.fn();
        renderPro(
            <AiSuggestNameButton
                suggest={() => Promise.resolve('  React Docs  ')}
                onSuggested={onSuggested}
                onBusyChange={onBusyChange}
            />
        );
        fireEvent.click(screen.getByRole('button'));
        await waitFor(() => expect(onSuggested).toHaveBeenCalledWith('React Docs'));
        expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    });

    test('shows an error toast and clears busy when suggest throws', async () => {
        const onBusyChange = jest.fn();
        renderPro(
            <AiSuggestNameButton
                suggest={() => Promise.reject(new Error('boom'))}
                onSuggested={jest.fn()}
                onBusyChange={onBusyChange}
            />
        );
        fireEvent.click(screen.getByRole('button'));
        await waitFor(() => expect(showErrorToast).toHaveBeenCalled());
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
    });

    test('does not call suggest when disabled', () => {
        const suggest = jest.fn();
        const { container } = renderPro(<AiSuggestNameButton suggest={suggest} onSuggested={jest.fn()} disabled disabledReason="nope" />);
        fireEvent.click(screen.getByRole('button'));
        expect(suggest).not.toHaveBeenCalled();
        expect(container.querySelector('.ai-suggest-name-btn-wrap')).toHaveAttribute('data-tooltip-content', 'nope');
    });

    test('free users can click a disabled suggestion button to open the Pro paywall', () => {
        const store = createStore();
        const suggest = jest.fn();
        render(
            <Provider store={store}>
                <AiSuggestNameButton suggest={suggest} onSuggested={jest.fn()} disabled disabledReason="no source" />
            </Provider>,
        );

        const button = screen.getByRole('button', { name: /suggest name with ai/i });
        expect(button).not.toBeDisabled();
        fireEvent.click(button);

        expect(suggest).not.toHaveBeenCalled();
        expect(store.get(aiToolsInitialToolState)).toBe('name-suggestion');
        expect(store.get(aiToolsModalOpenState)).toBe(true);
    });
});
