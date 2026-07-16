/** @jest-environment jsdom */
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { browser } from '../static/globals';
import ManageSubscriptionModal, { formatAmount } from '../app/ManageSubscriptionModal';
import { manageSubscriptionOpenState } from '../app/atoms/premiumState';

jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
}));

const SUB = {
    plan: 'monthly',
    status: 'active',
    next_billed_at: '2026-08-01T00:00:00Z',
    current_period_end: '2026-08-01T00:00:00Z',
    scheduled_change: null,
    update_payment_method_url: 'https://paddle.test/pay',
};

const manageSubscriptionCss = fs.readFileSync(path.join(__dirname, '../app/ManageSubscriptionModal.css'), 'utf8');

const renderModal = () => {
    const store = createStore();
    store.set(manageSubscriptionOpenState, true);
    render(
        <Provider store={store}>
            <ManageSubscriptionModal />
        </Provider>,
    );
    return store;
};

describe('ManageSubscriptionModal', () => {
    beforeEach(() => {
        browser.runtime.sendMessage.mockReset();
    });

    test('loads and shows plan, status, and renewal date', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ ok: true, data: SUB });
        renderModal();

        expect(await screen.findByText('Tabox Pro — monthly')).toBeInTheDocument();
        expect(screen.getByText('active')).toBeInTheDocument();
        expect(screen.getByText('Renews on')).toBeInTheDocument();
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'proGetSubscription' });
        expect(screen.getByRole('button', { name: /switch to annual/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel subscription/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /update payment method/i })).toHaveAttribute('href', 'https://paddle.test/pay');
    });

    test('adds spacing between the popup plan action buttons only', () => {
        const popupActionsRule = manageSubscriptionCss.match(/html:not\(\.fullpage-mode\) \.manage-subscription-modal \.manage-sub-plan-actions\s*{[^}]+}/)?.[0] || '';

        expect(popupActionsRule).toContain('gap: 10px');
    });

    test('switch plan: preview → confirm → commit', async () => {
        let plan = 'monthly';
        browser.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.type === 'proGetSubscription') return { ok: true, data: { ...SUB, plan } };
            if (msg.type === 'proChangePlan' && msg.preview) {
                return {
                    ok: true,
                    data: {
                        immediate: { action: 'charge', amount: '4200', currency: 'USD' },
                        recurring: { amount: '4900', currency: 'USD' },
                        next_billed_at: '2026-07-16T00:00:00Z',
                    },
                };
            }
            if (msg.type === 'proChangePlan') {
                plan = 'annual';
                return { ok: true, data: { ...SUB, plan } };
            }
            return { ok: false };
        });
        renderModal();

        fireEvent.click(await screen.findByRole('button', { name: /switch to annual/i }));

        expect(await screen.findByText(/switch to annual billing\?/i)).toBeInTheDocument();
        expect(screen.getByText('$42.00')).toBeInTheDocument();
        expect(screen.getByText('$49.00')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /confirm switch/i }));

        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'proChangePlan', plan: 'annual' });
        });
        expect(await screen.findByText('Tabox Pro — annual')).toBeInTheDocument();
    });

    test('cancel: confirm view then scheduled-cancel state with resume', async () => {
        let canceled = false;
        browser.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.type === 'proGetSubscription') {
                return {
                    ok: true,
                    data: canceled
                        ? { ...SUB, scheduled_change: { action: 'cancel', effective_at: '2026-08-01T00:00:00Z' } }
                        : SUB,
                };
            }
            if (msg.type === 'proCancelSubscription') {
                canceled = true;
                return { ok: true, data: { ...SUB, scheduled_change: { action: 'cancel', effective_at: '2026-08-01T00:00:00Z' } } };
            }
            if (msg.type === 'proResumeSubscription') {
                canceled = false;
                return { ok: true, data: SUB };
            }
            return { ok: false };
        });
        renderModal();

        fireEvent.click(await screen.findByRole('button', { name: /^cancel subscription$/i }));
        expect(await screen.findByText(/cancel your subscription\?/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^cancel subscription$/i }));

        expect(await screen.findByRole('button', { name: /resume subscription/i })).toBeInTheDocument();
        expect(screen.getByText(/set to cancel/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /resume subscription/i }));
        expect(await screen.findByRole('button', { name: /switch to annual/i })).toBeInTheDocument();
    });

    test('shows a friendly error when the account has no subscription', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'no_subscription' });
        renderModal();
        expect(await screen.findByText(/no active subscription/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});

describe('formatAmount', () => {
    test('converts lowest-unit amounts and handles zero-decimal currencies', () => {
        expect(formatAmount('4900', 'USD')).toBe('$49.00');
        expect(formatAmount('4900', 'JPY')).toMatch(/4,900/);
        expect(formatAmount('abc', 'USD')).toBeNull();
        expect(formatAmount('4900', null)).toBeNull();
    });
});
