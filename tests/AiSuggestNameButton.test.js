/** @jest-environment jsdom */
// tests/AiSuggestNameButton.test.js
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../app/ai/useTaboxAIEnabled', () => ({ useTaboxAIEnabled: jest.fn() }));
jest.mock('../app/ai/aiClient', () => ({ isAISupported: jest.fn() }));
jest.mock('../app/toastHelpers', () => ({ showErrorToast: jest.fn() }));

import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';
import { isAISupported } from '../app/ai/aiClient';
import { showErrorToast } from '../app/toastHelpers';
import AiSuggestNameButton from '../app/AiSuggestNameButton';

describe('AiSuggestNameButton', () => {
    beforeEach(() => {
        useTaboxAIEnabled.mockReturnValue(true);
        isAISupported.mockReturnValue(true);
        showErrorToast.mockReset();
    });

    test('renders nothing when AI is disabled', () => {
        useTaboxAIEnabled.mockReturnValue(false);
        const { container } = render(<AiSuggestNameButton suggest={jest.fn()} onSuggested={jest.fn()} />);
        expect(container.querySelector('.ai-suggest-name-btn')).toBeNull();
    });

    test('renders nothing when AI is unsupported', () => {
        isAISupported.mockReturnValue(false);
        const { container } = render(<AiSuggestNameButton suggest={jest.fn()} onSuggested={jest.fn()} />);
        expect(container.querySelector('.ai-suggest-name-btn')).toBeNull();
    });

    test('fills the field with the trimmed suggestion and toggles busy', async () => {
        const onSuggested = jest.fn();
        const onBusyChange = jest.fn();
        render(
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
        render(
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
        const { container } = render(<AiSuggestNameButton suggest={suggest} onSuggested={jest.fn()} disabled disabledReason="nope" />);
        fireEvent.click(screen.getByRole('button'));
        expect(suggest).not.toHaveBeenCalled();
        expect(container.querySelector('.ai-suggest-name-btn-wrap')).toHaveAttribute('data-tooltip-content', 'nope');
    });
});
