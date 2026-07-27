/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import SettingsMenu from '../app/SettingsMenu';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { getAIAvailability } from '../app/ai/aiClient';
import { showSuccessToast } from '../app/toastHelpers';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showErrorToast: jest.fn(),
    showUndoToast: jest.fn(),
    setToastViewContext: jest.fn(),
}));
jest.mock('../app/OrphanRecoveryContext', () => ({
    useOrphanRecoveryContext: () => ({}),
}));

const GOOGLE_ID = '00199224234660748495';

const renderSettingsMenu = (variant = 'popup') => {
    const store = createStore();
    store.set(premiumEntitlementState, null);

    return render(
        <Provider store={store}>
            <SettingsMenu
                variant={variant}
                updateRemoteData={jest.fn()}
                applyDataFromServer={jest.fn()}
            />
        </Provider>,
    );
};

const openSettings = (container) => {
    fireEvent.click(container.querySelector('.settings-button'));
};

describe('SettingsMenu — Google account ID row', () => {
    let writeText;

    beforeEach(() => {
        browser.storage.local.get.mockReset();
        browser.storage.local.set.mockReset();
        browser.storage.local.set.mockResolvedValue(undefined);
        browser.runtime.sendMessage.mockReset();
        browser.runtime.sendMessage.mockResolvedValue({});
        getAIAvailability.mockReset();
        getAIAvailability.mockResolvedValue(undefined);
        showSuccessToast.mockReset();
        writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
    });

    test('popup, signed in: shows the id and copies it on click', async () => {
        browser.storage.local.get.mockImplementation(async () => ({
            googleUser: { permissionId: GOOGLE_ID, emailAddress: 'darkstorm13@gmail.com' },
        }));
        const { container } = renderSettingsMenu();
        openSettings(container);

        const copyButton = await screen.findByRole('button', { name: new RegExp(`Google ID: ${GOOGLE_ID}`) });

        fireEvent.click(copyButton);
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(GOOGLE_ID));
        await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    });

    test('popup, signed out: shows sign-in prompt on a disabled button', async () => {
        browser.storage.local.get.mockImplementation(async () => ({}));
        const { container } = renderSettingsMenu();
        openSettings(container);

        const button = await screen.findByRole('button', { name: /google id — sign in to view/i });
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(writeText).not.toHaveBeenCalled();
    });

    test('full page: shows the row title and signed-in account email', async () => {
        browser.storage.local.get.mockImplementation(async () => ({
            googleUser: { permissionId: GOOGLE_ID, emailAddress: 'darkstorm13@gmail.com' },
        }));
        const { container } = renderSettingsMenu('fullpage');
        openSettings(container);
        fireEvent.click(screen.getByRole('button', { name: 'Tabox Pro' }));

        expect(await screen.findByText('Google account ID')).toBeInTheDocument();
        expect(screen.getByText(/darkstorm13@gmail\.com/)).toBeInTheDocument();
        const copyButton = screen.getByRole('button', { name: new RegExp(GOOGLE_ID) });
        fireEvent.click(copyButton);
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(GOOGLE_ID));
    });
});
