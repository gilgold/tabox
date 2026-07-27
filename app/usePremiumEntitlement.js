import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { browser } from '../static/globals';
import { premiumEntitlementState } from './atoms/premiumState';
import { isStale } from './utils/premiumUtils';

export function usePremiumEntitlement() {
    const setPremium = useSetAtom(premiumEntitlementState);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const cached = await browser.runtime.sendMessage({ type: 'getProEntitlement' });
            if (cancelled) return;
            if (cached) setPremium(cached);
            const { proCheckoutPendingUntil } = await browser.storage.local.get('proCheckoutPendingUntil');
            const checkoutPending = proCheckoutPendingUntil && Date.now() < proCheckoutPendingUntil;
            // Refresh ONLY when a cached record exists and is stale, or a checkout is
            // pending. `cached &&` is load-bearing: without it, every synced FREE user
            // would hit the Worker on popup open, violating the zero-calls constraint.
            if ((cached && isStale(cached)) || checkoutPending) {
                const fresh = await browser.runtime.sendMessage({ type: 'refreshProEntitlement' });
                if (cancelled || !fresh) return;
                // authError means re-auth is needed, not that entitlement is gone:
                // flag the cached record instead of replacing it, so grace-period
                // access and the `cached &&` guards stay intact. Never fabricate a
                // record when there is none (prev === null, e.g. checkoutPending):
                // a truthy record would defeat the zero-Worker-calls guards.
                if (fresh.authError) setPremium((prev) => (prev ? { ...prev, authError: true } : prev));
                else setPremium(fresh);
            }
        })();
        return () => { cancelled = true; };
    }, [setPremium]);
}
