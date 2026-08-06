import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import { browser } from '../static/globals';
import SettingsMenu from '../app/SettingsMenu';
import { getAIAvailability } from '../app/ai/aiClient';

// Mock the AI client so these tests never touch the network.
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showUndoToast: jest.fn(),
    setToastViewContext: jest.fn(),
}));

jest.mock('../app/OrphanRecoveryContext', () => ({
    useOrphanRecoveryContext: () => ({}),
}));

const renderSettings = async () => {
    await act(async () => {
        render(
            <Provider>
                <SettingsMenu updateRemoteData={jest.fn()} applyDataFromServer={jest.fn()} />
            </Provider>
        );
    });
    fireEvent.click(document.querySelector('.settings-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Tabox AI' }));
};

describe('SettingsMenu — Tabox AI section', () => {
    beforeEach(() => {
        browser.storage.local.get.mockReset();
        browser.storage.local.set.mockReset();
        browser.storage.local.get.mockResolvedValue({});
        getAIAvailability.mockReset();
        getAIAvailability.mockResolvedValue(undefined);
    });

    test('renders a Tabox AI section with the enable switch', async () => {
        await renderSettings();
        expect(screen.getByRole('heading', { name: 'Tabox AI', level: 3 })).toBeInTheDocument();
        expect(document.getElementById('chkTaboxAI')).toBeInTheDocument();
    });

    test('clicking the AI switch when OFF opens the modal and never writes chkTaboxAI: true to storage', async () => {
        // Switch starts unchecked (storage returns nothing for chkTaboxAI)
        await renderSettings();

        const checkbox = document.getElementById('chkTaboxAI');
        expect(checkbox.checked).toBe(false);

        // fireEvent.click on a checkbox is equivalent to the Space-key path —
        // it fires a change event, which is where our gate now lives.
        await act(async () => {
            fireEvent.click(checkbox);
        });

        // The modal should appear (AIEnableModal is lazy — wait for it)
        expect(await screen.findByText(/sent to OpenRouter for processing/i)).toBeInTheDocument();

        // Storage must NOT have been called with the enabled flag
        const setCalls = browser.storage.local.set.mock.calls;
        const enableCalls = setCalls.filter(
            ([arg]) => arg && arg.chkTaboxAI === true
        );
        expect(enableCalls).toHaveLength(0);
    });

    test('after click-veto the checkbox stays unchecked', async () => {
        await renderSettings();

        const checkbox = document.getElementById('chkTaboxAI');
        await act(async () => {
            fireEvent.click(checkbox);
        });

        // The veto reverts target.checked synchronously
        expect(checkbox.checked).toBe(false);
    });

    test('toggling OFF (switch already ON) skips modal and writes chkTaboxAI: false', async () => {
        // Pre-set storage so the Switch initialises as checked
        browser.storage.local.get.mockImplementation((key) => {
            if (key === 'chkTaboxAI') return Promise.resolve({ chkTaboxAI: true });
            return Promise.resolve({});
        });

        await renderSettings();

        // Wait for the switch to read storage and reflect checked state
        await waitFor(() => {
            expect(document.getElementById('chkTaboxAI').checked).toBe(true);
        });

        browser.storage.local.set.mockReset();

        const checkbox = document.getElementById('chkTaboxAI');
        await act(async () => {
            fireEvent.click(checkbox);
        });

        // No modal should have appeared
        expect(screen.queryByText(/sent to OpenRouter for processing/i)).not.toBeInTheDocument();

        // Storage must have been written with the disabled flag
        await waitFor(() => {
            const setCalls = browser.storage.local.set.mock.calls;
            const disableCalls = setCalls.filter(
                ([arg]) => arg && arg.chkTaboxAI === false
            );
            expect(disableCalls.length).toBeGreaterThan(0);
        });
    });
});
