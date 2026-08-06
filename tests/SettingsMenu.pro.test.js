/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import SettingsMenu from '../app/SettingsMenu';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { getAIAvailability } from '../app/ai/aiClient';

const taboxProOverviewCss = fs.readFileSync(path.join(__dirname, '../app/TaboxProOverview.css'), 'utf8');
const settingsMenuCss = fs.readFileSync(path.join(__dirname, '../app/SettingsMenu.css'), 'utf8');
const manageSubscriptionCss = fs.readFileSync(path.join(__dirname, '../app/ManageSubscriptionModal.css'), 'utf8');

// AIEnableModal is lazily imported by SettingsMenu — mock its deps to keep
// this test focused and fast (mirrors SettingsMenuTaboxAI.test.js).
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
    fireEvent.click(screen.getByRole('button', { name: 'Tabox Pro' }));
};

describe('SettingsMenu — Tabox Pro section', () => {
    beforeEach(() => {
        browser.storage.local.get.mockReset();
        browser.storage.local.set.mockReset();
        browser.storage.local.get.mockResolvedValue({});
        browser.runtime.sendMessage.mockReset();
        browser.runtime.sendMessage.mockResolvedValue({});
        getAIAvailability.mockReset();
        getAIAvailability.mockResolvedValue(undefined);
    });

    test('shows Upgrade CTA for free users', () => {
        const { container } = renderSettingsMenu(null);

        openSettings(container);

        expect(screen.getByRole('heading', { name: 'Tabox Pro', level: 3 })).toBeInTheDocument();
        expect(screen.getByText('Free plan')).toBeInTheDocument();
        const upgradeButton = screen.getByRole('button', { name: /start free 7-day trial/i });
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

        expect(screen.getByRole('heading', { name: 'Tabox Pro', level: 3 })).toBeInTheDocument();
        const planStatus = screen.getByText(/Active \(Trial\) — ends/);
        const activeOverview = planStatus.closest('.fp-settings-pro-active-overview');
        const activeOverviewRule = settingsMenuCss.match(/\.fp-settings-modal-shell--popup \.fp-settings-pro-active-overview\s*{[^}]+}/)?.[0] || '';
        const planDetailsRule = settingsMenuCss.match(/\.fp-settings-modal-shell--popup \.fp-settings-pro-active-overview \.fp-settings-plan-details\s*{[^}]+}/)?.[0] || '';
        const manageButtonRule = settingsMenuCss.match(/\.fp-settings-modal-shell--popup \.fp-settings-pro-active-overview \.fp-settings-menu-button\s*{[^}]+}/)?.[0] || '';

        expect(activeOverview).toBeInTheDocument();
        expect(activeOverview).toHaveTextContent('Subscription controls');
        expect(screen.getByRole('button', { name: /manage subscription/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
        expect(activeOverviewRule).toContain('overflow: hidden');
        expect(activeOverviewRule).toContain('linear-gradient');
        expect(planDetailsRule).toContain('display: grid');
        expect(planDetailsRule).toContain('grid-template-columns: 44px minmax(0, 1fr)');
        expect(manageButtonRule).toContain('linear-gradient');
    });

    test('shows Active (Monthly) / Active (Yearly) for paid plans', () => {
        const { container } = renderSettingsMenu({
            entitled: true,
            status: 'active',
            plan: 'annual',
            expiresAt: '2027-07-01T10:00:00Z',
            refreshedAt: new Date().toISOString(),
        });

        openSettings(container);

        expect(screen.getByText('Active (Yearly)')).toBeInTheDocument();
    });

    test('notes a scheduled cancellation on the plan overview', () => {
        const { container } = renderSettingsMenu({
            entitled: true,
            status: 'trialing',
            plan: 'monthly',
            expiresAt: '2026-07-23T10:00:00Z',
            cancelAt: '2026-07-23T10:00:00Z',
            refreshedAt: new Date().toISOString(),
        });

        openSettings(container);

        expect(screen.getByText(/Active \(Trial\) — canceled, won't renew after/)).toBeInTheDocument();
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

    test('shows the benefit-led Pro overview and non-interactive pricing in the full-page view', () => {
        const { container } = renderSettingsMenu(null, 'fullpage');

        openSettings(container);
        fireEvent.click(screen.getByRole('button', { name: 'Tabox Pro' }));

        expect(screen.getByRole('heading', { name: 'Upgrade your tab workflow' })).toBeInTheDocument();
        expect(screen.getByText('Organize with AI')).toBeInTheDocument();
        expect(screen.getByText('Share anything')).toBeInTheDocument();
        expect(screen.getByText('Stay in control')).toBeInTheDocument();
        expect(screen.getByText('$5.99 / month')).toBeInTheDocument();
        expect(screen.getByText('$59.99 / year')).toBeInTheDocument();
        const savingsBadge = screen.getByText('2 months free!');
        expect(savingsBadge).toBeInTheDocument();
        const yearlyPriceCard = savingsBadge.closest('.fp-pro-price');
        expect(yearlyPriceCard).toBeInTheDocument();
        expect(yearlyPriceCard).toHaveTextContent('Yearly');
        expect(yearlyPriceCard).not.toHaveTextContent('Monthly');
        const savingsBadgeRule = taboxProOverviewCss.match(/\.fp-pro-savings\s*\{[^}]+}/)?.[0] || '';
        expect(savingsBadgeRule).toContain('position: absolute');
        expect(savingsBadgeRule).toMatch(/transform:\s*rotate\([^)]*deg\)/);
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();

        const upgradeButton = screen.getByRole('button', { name: /upgrade — start free 7-day trial/i });
        const upgradeButtonRule = taboxProOverviewCss.match(/\.fp-pro-upgrade-button\s*\{[^}]+}/)?.[0] || '';
        expect(upgradeButtonRule).toContain('white-space: nowrap');

        fireEvent.click(upgradeButton);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'openProCheckout' });
    });

    test('uses the compact offer-first Pro layout in the popup', () => {
        const { container } = renderSettingsMenu(null);

        openSettings(container);

        const style = document.createElement('style');
        style.textContent = taboxProOverviewCss;
        document.head.appendChild(style);
        const layout = document.querySelector('.fp-pro-overview-layout');
        const benefitList = document.querySelector('.fp-pro-benefit-list');
        const offerCard = document.querySelector('.fp-pro-offer-card');
        const popupUpgradeButton = screen.getByRole('button', { name: 'Start free 7-day trial' });
        const priceCards = document.querySelectorAll('.fp-pro-price');
        const popupBenefitListRule = taboxProOverviewCss.match(/(?:^|\n)\.fp-settings-modal-shell--popup \.fp-pro-overview--compact \.fp-pro-benefit-list\s*{[^}]+}/)?.[0] || '';
        const popupOfferRule = taboxProOverviewCss.match(/(?:^|\n)\.fp-settings-modal-shell--popup \.fp-pro-overview--compact \.fp-pro-offer-card\s*{[^}]+}/)?.[0] || '';
        const popupYearlyRule = taboxProOverviewCss.match(/(?:^|\n)\.fp-settings-modal-shell--popup \.fp-pro-overview--compact \.fp-pro-price\.is-yearly\s*{[^}]+}/)?.[0] || '';
        const popupCtaRule = taboxProOverviewCss.match(/(?:^|\n)\.fp-settings-modal-shell--popup \.fp-pro-overview--compact \.fp-pro-upgrade-button\s*{[^}]+}/)?.[0] || '';

        expect(layout.firstElementChild).toHaveClass('fp-pro-offer-card');
        expect(layout.lastElementChild).toHaveClass('fp-pro-benefits');
        expect(screen.getByRole('heading', { name: 'Everything included' })).toBeInTheDocument();
        expect(screen.getByText('Group, rename & clean up')).toBeInTheDocument();
        expect(priceCards[1]).toHaveClass('is-yearly');
        expect(popupBenefitListRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
        expect(popupOfferRule).toContain('grid-template-columns: 42px minmax(0, 1fr)');
        expect(popupYearlyRule).toContain('linear-gradient');
        expect(popupCtaRule).toContain('linear-gradient');
        expect(popupCtaRule).toContain('box-shadow');
        expect(popupCtaRule).toContain('margin: 16px 0 0');
        expect(popupUpgradeButton).toBeInTheDocument();
        expect(window.getComputedStyle(offerCard).display).toBe('grid');
        expect(window.getComputedStyle(benefitList).display).toBe('grid');
        expect(window.getComputedStyle(benefitList).gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
        expect(window.getComputedStyle(popupUpgradeButton).marginTop).toBe('16px');
        expect(window.getComputedStyle(popupUpgradeButton).minHeight).toBe('42px');
        expect(taboxProOverviewCss).not.toContain(':is(html.fullpage-mode .fp-settings-modal-shell, .fp-settings-modal-shell--popup) .fp-pro-upgrade-button');

        style.remove();
    });

    test('shows subscription controls inside the popup settings modal', async () => {
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

        const { container } = renderSettingsMenu({
            entitled: true,
            status: 'active',
            plan: 'monthly',
            refreshedAt: new Date().toISOString(),
        });

        openSettings(container);
        fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));

        const planDetails = await screen.findByText('Tabox Pro — monthly');
        const popupShell = document.querySelector('.fp-settings-modal-shell--popup');
        const inlineControls = planDetails.closest('.manage-sub-controls-inline');
        const backButton = screen.getByRole('button', { name: /plan overview/i });
        const controlsRule = manageSubscriptionCss.match(/\.fp-settings-modal-shell--popup \.manage-sub-controls-inline\s*{[^}]+}/)?.[0] || '';
        const headerRule = manageSubscriptionCss.match(/\.fp-settings-modal-shell--popup \.manage-sub-inline-header\s*{[^}]+}/)?.[0] || '';
        const summaryRule = manageSubscriptionCss.match(/\.fp-settings-modal-shell--popup \.manage-sub-controls-inline \.manage-sub-summary\s*{[^}]+}/)?.[0] || '';
        const summaryAccentRule = manageSubscriptionCss.match(/\.fp-settings-modal-shell--popup \.manage-sub-controls-inline \.manage-sub-summary::before\s*{[^}]+}/)?.[0] || '';
        const actionsRule = manageSubscriptionCss.match(/\.fp-settings-modal-shell--popup \.manage-sub-controls-inline \.manage-sub-plan-actions\s*{[^}]+}/)?.[0] || '';
        const primaryRule = manageSubscriptionCss.match(/\.fp-settings-modal-shell--popup \.manage-sub-controls-inline \.manage-sub-btn-primary\s*{[^}]+}/)?.[0] || '';

        expect(popupShell).toContainElement(planDetails);
        expect(inlineControls).toBeInTheDocument();
        expect(backButton).toHaveTextContent('Plan overview');
        expect(controlsRule).toContain('width: 100%');
        expect(headerRule).toContain('grid-template-columns: minmax(0, 1fr) auto');
        expect(summaryRule).toContain('linear-gradient');
        expect(summaryAccentRule).toBe('');
        expect(actionsRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
        expect(primaryRule).toContain('linear-gradient');
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

        const { container } = renderSettingsMenu({
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

        const upgradeButton = screen.getByRole('button', { name: /start free 7-day trial/i });
        fireEvent.click(upgradeButton);

        await screen.findByRole('heading', { name: 'Tabox Pro', level: 3 });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'openProCheckout' });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login' });
        expect(
            browser.runtime.sendMessage.mock.calls.filter((c) => c[0].type === 'openProCheckout').length,
        ).toBeGreaterThanOrEqual(2);
    });

    test('opening settings refreshes a cached entitlement so external changes show up', async () => {
        browser.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.type === 'refreshProEntitlement') {
                return {
                    entitled: false,
                    status: 'canceled',
                    plan: 'monthly',
                    expiresAt: null,
                    cancelAt: null,
                    refreshedAt: new Date().toISOString(),
                };
            }
            return {};
        });

        const { container } = renderSettingsMenu({
            entitled: true,
            status: 'trialing',
            plan: 'monthly',
            expiresAt: '2026-07-25T10:00:00Z',
            refreshedAt: new Date().toISOString(),
        });

        openSettings(container);

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'refreshProEntitlement' });
        expect(await screen.findByText('Free plan')).toBeInTheDocument();
        expect(screen.queryByText(/Active \(Trial\)/)).not.toBeInTheDocument();
    });

    test('opening settings does NOT call the Worker when there is no cached entitlement', () => {
        const { container } = renderSettingsMenu(null);

        openSettings(container);

        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'refreshProEntitlement' });
    });

    test('a failed refresh keeps showing the cached status', async () => {
        browser.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.type === 'refreshProEntitlement') return null;
            return {};
        });

        const { container } = renderSettingsMenu({
            entitled: true,
            status: 'trialing',
            plan: 'monthly',
            expiresAt: '2026-07-25T10:00:00Z',
            refreshedAt: new Date().toISOString(),
        });

        openSettings(container);

        expect(await screen.findByText(/Active \(Trial\) — ends/)).toBeInTheDocument();
    });

});
