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
