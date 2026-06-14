/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';

jest.mock('../app/ai/useTaboxAIEnabled', () => ({ useTaboxAIEnabled: jest.fn() }));
jest.mock('../app/ai/aiClient', () => ({ isAISupported: jest.fn() }));
jest.mock('../app/toastHelpers', () => ({ showErrorToast: jest.fn() }));
jest.mock('../app/ai/tasks/suggestCollectionName', () => ({ suggestCollectionName: jest.fn() }));
jest.mock('../app/utils', () => ({
    getCurrentTabsAndGroups: jest.fn(),
    getAllWindowsTabsAndGroups: jest.fn(),
}));

import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';
import { isAISupported } from '../app/ai/aiClient';
import { suggestCollectionName } from '../app/ai/tasks/suggestCollectionName';
import { getCurrentTabsAndGroups } from '../app/utils';
import { showErrorToast } from '../app/toastHelpers';
import AddNewTextbox from '../app/AddNewTextbox';

const renderBox = async () => {
    await act(async () => {
        render(
            <Provider>
                <AddNewTextbox addCollection={jest.fn()} addFolder={jest.fn()} onDataUpdate={jest.fn()} />
            </Provider>
        );
    });
};

describe('AddNewTextbox AI suggest', () => {
    beforeEach(() => {
        useTaboxAIEnabled.mockReturnValue(true);
        isAISupported.mockReturnValue(true);
        getCurrentTabsAndGroups.mockResolvedValue({ tabs: [{ title: 'React Docs', url: 'https://react.dev' }] });
        suggestCollectionName.mockReset();
    });

    test('suggests a name from the current window and fills the input', async () => {
        suggestCollectionName.mockResolvedValue('React Learning');
        await renderBox();
        fireEvent.click(screen.getByRole('button', { name: /suggest name with ai/i }));
        await waitFor(() => expect(screen.getByDisplayValue('React Learning')).toBeInTheDocument());
        expect(suggestCollectionName).toHaveBeenCalledWith({ tabs: [expect.objectContaining({ title: 'React Docs' })] });
    });

    test('shows error toast and leaves input empty when suggestCollectionName rejects', async () => {
        suggestCollectionName.mockRejectedValue(new Error('AI unavailable'));
        await renderBox();
        fireEvent.click(screen.getByRole('button', { name: /suggest name with ai/i }));
        await waitFor(() => expect(showErrorToast).toHaveBeenCalled());
        expect(screen.getByRole('textbox').value).toBe('');
    });

    test('does not render the AI button when AI is disabled', async () => {
        useTaboxAIEnabled.mockReturnValue(false);
        await renderBox();
        expect(screen.queryByRole('button', { name: /suggest name with ai/i })).toBeNull();
    });
});
