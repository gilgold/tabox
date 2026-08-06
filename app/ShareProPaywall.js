import React, { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { browser } from '../static/globals';
import { premiumEntitlementState } from './atoms/premiumState';
import TaboxProUpsell from './TaboxProUpsell';
import useProCheckout from './useProCheckout';

export default function ShareProPaywall() {
    const [isSignedIn, setIsSignedIn] = useState(false);
    const setPremiumEntitlement = useSetAtom(premiumEntitlementState);
    const startProCheckout = useProCheckout();

    useEffect(() => {
        let live = true;
        browser.storage.local.get('googleUser')
            .then(({ googleUser }) => {
                if (live) setIsSignedIn(Boolean(googleUser));
            })
            .catch(() => {});
        return () => { live = false; };
    }, []);

    const signIn = async () => {
        const loggedIn = await browser.runtime.sendMessage({ type: 'login' });
        if (!loggedIn) return;
        setIsSignedIn(true);
        const entitlement = await browser.runtime.sendMessage({ type: 'refreshProEntitlement' });
        if (entitlement && !entitlement.authError) {
            setPremiumEntitlement(entitlement);
        }
    };

    return (
        <div className="share-pro-paywall">
            <TaboxProUpsell
                isSignedIn={isSignedIn}
                onUpgrade={() => startProCheckout({ ensureLogin: true })}
                onSignIn={signIn}
                onEntitlementRefreshed={setPremiumEntitlement}
            />
        </div>
    );
}
