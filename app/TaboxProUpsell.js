import React, { useEffect, useRef } from 'react';
import { MdWorkspacePremium } from 'react-icons/md';
import { browser } from '../static/globals';
import './TaboxProUpsell.css';

// Cross-device unlock: a user who subscribed on another device should see the
// tool unlock the moment they open the upsell, without any polling for free
// (signed-out) users. Fires one refreshProEntitlement on mount when signed in
// and pushes a non-null result into premiumEntitlementState via the callback.
export default function TaboxProUpsell({ isSignedIn, onUpgrade, onSignIn, onEntitlementRefreshed }) {
    const refreshedRef = useRef(false);

    useEffect(() => {
        if (!isSignedIn || refreshedRef.current) return;
        refreshedRef.current = true;
        browser.runtime.sendMessage({ type: 'refreshProEntitlement' })
            .then((entitlement) => {
                if (entitlement && typeof onEntitlementRefreshed === 'function') {
                    onEntitlementRefreshed(entitlement);
                }
            })
            .catch(() => {});
    }, [isSignedIn, onEntitlementRefreshed]);

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
            {isSignedIn ? (
                <button className="pro-upsell-cta" onClick={onUpgrade}>Upgrade — start free trial</button>
            ) : (
                <button className="pro-upsell-cta" onClick={onSignIn}>Sign in with Google to start</button>
            )}
        </div>
    );
}
