/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import SettingsMenu from '../app/SettingsMenu';
import { premiumEntitlementState, manageSubscriptionOpenState } from '../app/atoms/premiumState';

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

const renderSettingsMenu = (premium = null, variant = 'popup') => {
    const store = createStore();
    store.set(premiumEntitlementState, premium);

    const view = render(
        <Provider store={store}>
            <SettingsMenu
                variant={variant}
                updateRemoteData={jest.fn()}
                applyDataFromServer={jest.fn()}
            />
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

    test('renders the current plan as read-only plan details in the full-page view', () => {
        const { container } = renderSettingsMenu(null, 'fullpage');

        openSettings(container);
        fireEvent.click(screen.getByRole('button', { name: 'Tabox Pro' }));

        const planStatus = screen.getByText('Free plan');
        const planDetails = planStatus.closest('.fp-settings-plan-details');

        expect(planDetails).toBeInTheDocument();
        expect(planDetails).toHaveTextContent('Current plan');
        expect(planStatus.closest('button')).toBeNull();
        expect(planDetails).not.toHaveClass('fp-settings-item-card');
    });

    test('Manage subscription opens the shared modal via the atom', () => {
        const { container, store } = renderSettingsMenu({
            entitled: true,
            status: 'active',
            plan: 'monthly',
            refreshedAt: new Date().toISOString(),
        });

        openSettings(container);
        fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));

        expect(store.get(manageSubscriptionOpenState)).toBe(true);
    });

    test('shows subscription controls inside the full-page settings modal', async () => {
        browser.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.type === 'proGetSubscription') {
                return {
                    ok: true,
                    data: {
                        plan: 'monthly',
                        status: 'active',
                        next_billed_at: '2026-08-01T00:00:00Z',
                        current_period_end: '2026-08-01T00:00:00Z',
                        scheduled_change: null,
                    },
                };
            }
            return {};
        });

        const { container, store } = renderSettingsMenu({
            entitled: true,
            status: 'active',
            plan: 'monthly',
            refreshedAt: new Date().toISOString(),
        }, 'fullpage');

        openSettings(container);
        fireEvent.click(screen.getByRole('button', { name: 'Tabox Pro' }));
        fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));

        const planDetails = await screen.findByText('Tabox Pro — monthly');
        expect(document.querySelector('.fp-settings-modal-shell')).toBeInTheDocument();
        expect(document.querySelector('.fp-settings-main-content')).toContainElement(planDetails);
        expect(screen.getByRole('button', { name: /back to plan overview/i })).toBeInTheDocument();
        const switchButton = screen.getByRole('button', { name: /switch to annual billing/i });
        const cancelButton = screen.getByRole('button', { name: /^cancel subscription$/i });
        expect(switchButton.closest('.manage-sub-plan-actions')).toContainElement(cancelButton);
        expect(store.get(manageSubscriptionOpenState)).toBe(false);
    });

    test('signed-out free user: Upgrade click signs in then retries checkout', async () => {
        browser.runtime.sendMessage.mockImplementation((msg) => {
            if (msg.type === 'openProCheckout') {
                return browser.runtime.sendMessage.mock.calls.filter((c) => c[0].type === 'openProCheckout').length === 1
                    ? Promise.resolve(false)
                    : Promise.resolve(true);
            }
            if (msg.type === 'login') return Promise.resolve(true);
            return Promise.resolve({});
        });

        const { container } = renderSettingsMenu(null);
        openSettings(container);

        const upgradeButton = screen.getByRole('button', { name: /upgrade/i });
        fireEvent.click(upgradeButton);

        await screen.findByText('Tabox Pro');
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'openProCheckout' });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login' });
        expect(
            browser.runtime.sendMessage.mock.calls.filter((c) => c[0].type === 'openProCheckout').length,
        ).toBeGreaterThanOrEqual(2);
    });
});
