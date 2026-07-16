/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import SettingsMenu from '../app/SettingsMenu';
import { premiumEntitlementState } from '../app/atoms/premiumState';

// AIEnableModal is lazily imported by SettingsMenu — mock its deps to keep
// this test focused and fast (mirrors SettingsMenuTaboxAI.test.js).
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
    downloadModel: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showUndoToast: jest.fn(),
    setToastViewContext: jest.fn(),
}));
jest.mock('../app/OrphanRecoveryContext', () => ({
    useOrphanRecoveryContext: () => ({}),
}));

const renderSettingsMenu = (premium = null) => {
    const store = createStore();
    store.set(premiumEntitlementState, premium);

    const view = render(
        <Provider store={store}>
            <SettingsMenu updateRemoteData={jest.fn()} applyDataFromServer={jest.fn()} />
        </Provider>,
    );

    return { ...view, store };
};

const openSettings = (container) => {
    fireEvent.click(container.querySelector('.settings-button'));
};

describe('SettingsMenu — Tabox Pro section', () => {
    beforeEach(() => {
        browser.storage.local.get.mockReset();
        browser.storage.local.set.mockReset();
        browser.storage.local.get.mockResolvedValue({});
        browser.runtime.sendMessage.mockReset();
        browser.runtime.sendMessage.mockResolvedValue({});
    });

    test('shows Upgrade CTA for free users', () => {
        const { container } = renderSettingsMenu(null);

        openSettings(container);

        expect(screen.getByText('Tabox Pro')).toBeInTheDocument();
        expect(screen.getByText('Free plan')).toBeInTheDocument();
        const upgradeButton = screen.getByRole('button', { name: /upgrade/i });
        expect(upgradeButton).toBeInTheDocument();

        fireEvent.click(upgradeButton);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'openProCheckout' });
    });

    test('shows trial status and Manage subscription for Pro users', () => {
        const { container } = renderSettingsMenu({
            entitled: true,
            status: 'trialing',
            plan: 'monthly',
            expiresAt: '2026-07-23T10:00:00Z',
            refreshedAt: new Date().toISOString(),
        });

        openSettings(container);

        expect(screen.getByText('Tabox Pro')).toBeInTheDocument();
        expect(screen.getByText(/trial/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /manage subscription/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    });
});
