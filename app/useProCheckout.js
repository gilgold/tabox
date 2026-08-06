import { useCallback } from 'react';
import { browser } from '../static/globals';

// The single path to Pro checkout for every UI entry point. ensureLogin
// retries checkout after a login round-trip, matching the flow the settings
// menu has always used.
export default function useProCheckout() {
    return useCallback(async ({ ensureLogin = false } = {}) => {
        const ok = await browser.runtime.sendMessage({ type: 'openProCheckout' });
        if (!ok && ensureLogin) {
            const loggedIn = await browser.runtime.sendMessage({ type: 'login' });
            if (loggedIn) await browser.runtime.sendMessage({ type: 'openProCheckout' });
        }
    }, []);
}
