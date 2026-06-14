/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../app/ai/useTaboxAIEnabled', () => ({ useTaboxAIEnabled: jest.fn() }));
jest.mock('../app/ai/aiClient', () => ({ isAISupported: jest.fn() }));
jest.mock('../app/toastHelpers', () => ({ showErrorToast: jest.fn() }));

import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';
import { isAISupported } from '../app/ai/aiClient';
import { AutoSaveTextbox } from '../app/AutoSaveTextbox';

describe('AutoSaveTextbox aiSuggest', () => {
    beforeEach(() => {
        useTaboxAIEnabled.mockReturnValue(true);
        isAISupported.mockReturnValue(true);
    });

    test('renders no AI button when aiSuggest is absent', () => {
        const { container } = render(
            <AutoSaveTextbox initValue="Group" item={{}} action={jest.fn()} />
        );
        expect(container.querySelector('.ai-suggest-name-btn')).toBeNull();
    });

    test('fills the input with the suggestion when the AI button is clicked', async () => {
        render(
            <AutoSaveTextbox
                initValue="Group"
                item={{}}
                action={jest.fn()}
                aiSuggest={{ suggest: () => Promise.resolve('Research Papers') }}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /suggest name with ai/i }));
        await waitFor(() => expect(screen.getByDisplayValue('Research Papers')).toBeInTheDocument());
    });

    test('suggested name is auto-saved via the action callback', async () => {
        jest.useFakeTimers();
        const action = jest.fn();
        render(
            <AutoSaveTextbox initValue="Group" item={{ uid: 'g1' }} action={action}
                aiSuggest={{ suggest: () => Promise.resolve('Research Papers') }} />
        );
        // Advance past the 200ms isInitial guard so the value-change effect is armed
        await act(async () => { jest.advanceTimersByTime(200); });
        // Click the AI button (triggers async suggest())
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /suggest name with ai/i })); });
        // Advance past the 700ms action debounce
        await act(async () => { jest.advanceTimersByTime(800); });
        expect(action).toHaveBeenCalledWith('Research Papers', { uid: 'g1' });
        jest.useRealTimers();
    });
});
