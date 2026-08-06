/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
    isAISupported: jest.fn().mockReturnValue(true),
}));
jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    loadAllCollections: jest.fn(),
    loadAllFolders: jest.fn().mockResolvedValue([]),
}));
jest.mock('../app/toastHelpers', () => ({
    showUndoToast: jest.fn(),
    showSuccessToast: jest.fn(),
}));
jest.mock('../app/ai/useSmartOrganizeUndo', () => ({
    useSmartOrganizeUndo: () => ({ snapshot: null, undo: jest.fn(), dismiss: jest.fn() }),
}));
jest.mock('../app/ai/useAutoArrangeUndo', () => ({
    useAutoArrangeUndo: () => ({ snapshot: null, undo: jest.fn(), dismiss: jest.fn() }),
}));

import { loadAllCollections } from '../app/utils/storageUtils';
import { getAIAvailability } from '../app/ai/aiClient';
import { browser } from '../static/globals';
import AIToolsModal from '../app/AIToolsModal';
import { aiToolsModalOpenState } from '../app/atoms/aiState';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { viewContextState } from '../app/atoms/globalAppSettingsState';

const PRO = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };

function renderModal({ premium = null, viewContext = 'popup' } = {}) {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    store.set(premiumEntitlementState, premium);
    store.set(viewContextState, viewContext);
    render(<Provider store={store}><AIToolsModal /></Provider>);
    return store;
}

describe('AIToolsModal premium gating', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        loadAllCollections.mockResolvedValue([]);
        getAIAvailability.mockResolvedValue('available');
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            return Promise.resolve({});
        });
        browser.storage.onChanged.addListener = jest.fn();
        browser.storage.onChanged.removeListener = jest.fn();
        browser.storage.local.get = jest.fn().mockResolvedValue({});
    });

    it('shows lock badges on premium tools for free users', () => {
        renderModal();
        expect(screen.getAllByTestId('ai-tool-lock').length).toBeGreaterThan(0);
    });

    it('clicking a locked tool shows the upsell instead of the tool', () => {
        renderModal();
        fireEvent.click(screen.getByText('Auto rename collections'));
        expect(screen.getByRole('heading', { name: 'Meet Tabox Pro' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start my free 7-day trial/i })).toBeInTheDocument();
    });

    it.each([
        ['popup', false],
        ['fullpage', true],
    ])('uses the shared responsive upsell in the %s modal', (viewContext, isFullPage) => {
        renderModal({ viewContext });
        fireEvent.click(screen.getByText('Auto rename collections'));

        const modal = document.querySelector('.ai-tools-modal');
        expect(modal).toHaveClass('ai-tools-modal');
        expect(modal.classList.contains('ai-tools-modal--fullpage')).toBe(isFullPage);
        expect(screen.getByRole('heading', { name: 'Organize tabs in seconds' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Share folders & collections' })).toBeInTheDocument();
    });

    it('upgrade button sends openProCheckout when signed in', async () => {
        browser.storage.local.get.mockResolvedValue({ googleUser: { permissionId: 'g-1' } });
        renderModal();
        fireEvent.click(screen.getByText('Auto rename collections'));
        const upgradeButton = await screen.findByRole('button', { name: /start my free 7-day trial/i });
        fireEvent.click(upgradeButton);
        await waitFor(() =>
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'openProCheckout' })
        );
    });

    it('shows no locks and opens tools normally for Pro users', () => {
        renderModal({ premium: PRO });
        expect(screen.queryAllByTestId('ai-tool-lock')).toHaveLength(0);
    });

    it('signed-out upsell: sign-in click applies the login + entitlement result without remounting the modal', async () => {
        browser.storage.local.get.mockResolvedValue({}); // no googleUser -> signed out
        let loggedIn = false;
        browser.runtime.sendMessage = jest.fn().mockImplementation((msg) => {
            if (msg.type === 'aiGetState') return Promise.resolve(null);
            if (msg.type === 'login') {
                loggedIn = true;
                return Promise.resolve(true);
            }
            // TaboxProUpsell also fires an (unrelated) refresh on mount while
            // optimistically-signed-in; only report entitled after the explicit
            // sign-in flow has actually logged in, so the test isolates the fix.
            if (msg.type === 'refreshProEntitlement') return Promise.resolve(loggedIn ? PRO : { entitled: false, status: 'none', refreshedAt: new Date().toISOString() });
            return Promise.resolve({});
        });

        const store = renderModal();
        fireEvent.click(screen.getByText('Auto rename collections'));

        const signInButton = await screen.findByRole('button', { name: /sign in with google/i });
        fireEvent.click(signInButton);

        // Sign-in + entitlement refresh resolve -> premiumEntitlementState is
        // populated (previously discarded) and the modal itself (still the same
        // instance — no remount) unlocks the tool instead of dead-ending on the
        // sign-in CTA.
        await waitFor(() => expect(store.get(premiumEntitlementState)).toEqual(PRO));
        expect(document.querySelector('.ai-tools-modal')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument();
    });
});
