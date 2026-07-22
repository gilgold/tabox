import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { browser } from '../static/globals';
import { isChromeBrowser } from './ai/browserSupport';
import { nonChromeProConfirmState } from './atoms/premiumState';

// The single path to Pro checkout for every UI entry point. On non-Chrome
// browsers, Tabox AI (a headline Pro feature) can never work, so checkout is
// preceded by NonChromeProConfirmModal — the purchase only proceeds after the
// user explicitly confirms. ensureLogin retries checkout after a login round-
// trip, matching the flow the settings menu has always used.
export default function useProCheckout() {
    const setConfirm = useSetAtom(nonChromeProConfirmState);

    return useCallback(async ({ ensureLogin = false } = {}) => {
        const proceed = async () => {
            const ok = await browser.runtime.sendMessage({ type: 'openProCheckout' });
            if (!ok && ensureLogin) {
                const loggedIn = await browser.runtime.sendMessage({ type: 'login' });
                if (loggedIn) await browser.runtime.sendMessage({ type: 'openProCheckout' });
            }
        };

        if (isChromeBrowser()) {
            await proceed();
            return;
        }
        setConfirm({ onConfirm: proceed });
    }, [setConfirm]);
}
