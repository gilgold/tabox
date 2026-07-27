/** @jest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { createElement } from 'react';

jest.mock('../static/globals', () => ({
    browser: {
        runtime: { sendMessage: jest.fn() },
        storage: { local: { get: jest.fn().mockResolvedValue({}) } },
    },
}));

import { browser } from '../static/globals';
import { premiumEntitlementState, isProState } from '../app/atoms/premiumState';
import { usePremiumEntitlement } from '../app/usePremiumEntitlement';

const FRESH = { entitled: true, status: 'active', plan: 'monthly', refreshedAt: new Date().toISOString() };
const STALE = { ...FRESH, refreshedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() };

const wrapperFor = (store) => ({ children }) => createElement(Provider, { store }, children);

describe('usePremiumEntitlement', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('loads cached record into the atom; skips refresh when fresh', async () => {
        browser.runtime.sendMessage.mockResolvedValueOnce(FRESH);
        const store = createStore();
        renderHook(() => usePremiumEntitlement(), { wrapper: wrapperFor(store) });
        await waitFor(() => expect(store.get(premiumEntitlementState)).toEqual(FRESH));
        expect(store.get(isProState)).toBe(true);
        expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('refreshes when a cached record exists and is stale', async () => {
        browser.runtime.sendMessage
            .mockResolvedValueOnce(STALE)   // getProEntitlement
            .mockResolvedValueOnce(FRESH);  // refreshProEntitlement
        const store = createStore();
        renderHook(() => usePremiumEntitlement(), { wrapper: wrapperFor(store) });
        await waitFor(() => expect(store.get(premiumEntitlementState)).toEqual(FRESH));
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'refreshProEntitlement' });
    });

    it('marks the cached record with authError (instead of replacing it) when the refresh hits an auth failure', async () => {
        browser.runtime.sendMessage
            .mockResolvedValueOnce(STALE)               // getProEntitlement
            .mockResolvedValueOnce({ authError: true }); // refreshProEntitlement
        const store = createStore();
        renderHook(() => usePremiumEntitlement(), { wrapper: wrapperFor(store) });
        await waitFor(() => expect(store.get(premiumEntitlementState)).toEqual({ ...STALE, authError: true }));
        // Stale-but-within-grace entitlement keeps tools unlocked while re-auth is pending.
        expect(store.get(isProState)).toBe(true);
    });

    it('keeps the atom null when a pending-checkout refresh hits an auth failure with no cached record (never fabricates a record)', async () => {
        browser.runtime.sendMessage
            .mockResolvedValueOnce(null)                // getProEntitlement — never entitled
            .mockResolvedValueOnce({ authError: true }); // refreshProEntitlement (checkout pending)
        browser.storage.local.get.mockResolvedValueOnce({ proCheckoutPendingUntil: Date.now() + 60_000 });
        const store = createStore();
        renderHook(() => usePremiumEntitlement(), { wrapper: wrapperFor(store) });
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'refreshProEntitlement' }));
        // Flush the pending setPremium so a fabricated record (the bug) would be caught.
        await new Promise((resolve) => setTimeout(resolve, 0));
        // A fabricated { authError: true } record would defeat the `if (!premium)`
        // zero-Worker-calls guards (e.g. SettingsMenu's refresh-on-open).
        expect(store.get(premiumEntitlementState)).toBe(null);
        expect(store.get(isProState)).toBe(false);
    });

    it('never refreshes when there is no cached record and no pending checkout (free users → zero Worker calls)', async () => {
        browser.runtime.sendMessage.mockResolvedValueOnce(null); // getProEntitlement
        const store = createStore();
        renderHook(() => usePremiumEntitlement(), { wrapper: wrapperFor(store) });
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1));
        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'refreshProEntitlement' });
    });

    it('isProState is false with no record', () => {
        const store = createStore();
        expect(store.get(isProState)).toBe(false);
    });
});
