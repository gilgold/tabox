import { useCallback } from 'react';
import { browser } from '../static/globals';

// The single path to Pro checkout for every UI entry point. ensureLogin
// retries checkout after a login round-trip, matching the flow the settings
// menu has always used.
export default function useProCheckout() {
    return useCallback(async ({ ensureLogin = false } = {}) => {
        const ok = await browser.runtime.sendMessage({ type: 'openProCheckout' });
        // thenCheckout: the background opens checkout itself once sign-in
        // lands — on Firefox for Android the sign-in tab can outlive this
        // message (the event page may be suspended meanwhile).
        if (!ok && ensureLogin) await browser.runtime.sendMessage({ type: 'login', thenCheckout: true });
    }, []);
}
