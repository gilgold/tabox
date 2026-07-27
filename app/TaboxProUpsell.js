import React, { useEffect, useRef, useState } from 'react';
import { MdWorkspacePremium } from 'react-icons/md';
import { browser } from '../static/globals';
import './TaboxProUpsell.css';

// Cross-device unlock: a user who subscribed on another device should see the
// tool unlock the moment they open the upsell, without any polling for free
// (signed-out) users. Fires one refreshProEntitlement on mount when signed in
// and pushes a non-null result into premiumEntitlementState via the callback.
// A { authError: true } result means the user looks signed in but their token
// is missing/revoked — a paying customer may hide behind the upsell, so show
// a session-expired state with a re-sign-in action instead of the upgrade CTA.
export default function TaboxProUpsell({ isSignedIn, onUpgrade, onSignIn, onEntitlementRefreshed }) {
    const refreshedRef = useRef(false);
    const [sessionExpired, setSessionExpired] = useState(false);

    useEffect(() => {
        if (!isSignedIn || refreshedRef.current) return;
        refreshedRef.current = true;
        browser.runtime.sendMessage({ type: 'refreshProEntitlement' })
            .then((entitlement) => {
                if (!entitlement) return;
                if (entitlement.authError) {
                    setSessionExpired(true);
                    return;
                }
                if (typeof onEntitlementRefreshed === 'function') {
                    onEntitlementRefreshed(entitlement);
                }
            })
            .catch(() => {});
    }, [isSignedIn, onEntitlementRefreshed]);

    // Only clear the expired state once re-auth actually restores a usable
    // entitlement: a cancelled sign-in or still-revoked token must keep the
    // session-expired banner (never fall back to the upgrade CTA for a
    // possibly-paying customer).
    const handleReSignIn = async () => {
        try {
            if (typeof onSignIn === 'function') await onSignIn();
            const entitlement = await browser.runtime.sendMessage({ type: 'refreshProEntitlement' });
            if (!entitlement || entitlement.authError) return;
            setSessionExpired(false);
            if (typeof onEntitlementRefreshed === 'function') {
                onEntitlementRefreshed(entitlement);
            }
        } catch {
            // Sign-in cancelled or failed — keep the session-expired state.
        }
    };

    return (
        <div className="pro-upsell">
            <MdWorkspacePremium className="pro-upsell-icon" />
            <h3>Tabox Pro</h3>
            <p>AI tools are part of Tabox Pro. Start a free 7-day trial — cancel anytime.</p>
            <ul className="pro-upsell-features">
                <li>Smart tab grouping</li>
                <li>Auto-rename &amp; auto-arrange collections</li>
                <li>Duplicate sweep &amp; collection splitting</li>
            </ul>
            {sessionExpired ? (
                <>
                    <div className="pro-upsell-session-expired" role="alert">
                        Your session expired — sign in again to restore your Tabox Pro access.
                    </div>
                    <button className="pro-upsell-cta" onClick={handleReSignIn}>Sign in again</button>
                </>
            ) : isSignedIn ? (
                <button className="pro-upsell-cta" onClick={onUpgrade}>Upgrade — start free trial</button>
            ) : (
                <button className="pro-upsell-cta" onClick={onSignIn}>Sign in with Google to start</button>
            )}
        </div>
    );
}
