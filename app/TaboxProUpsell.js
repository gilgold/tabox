import React, { useEffect, useRef, useState } from 'react';
import { MdAutoAwesome, MdFolderShared } from 'react-icons/md';
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
        <section className="pro-upsell" aria-labelledby="pro-upsell-title">
            <div className="pro-upsell-hero" aria-hidden="true">
                <img
                    className="pro-upsell-hero-image"
                    src="./images/tabox-pro-ai-sharing-hero.png"
                    alt=""
                />
            </div>

            <div className="pro-upsell-heading">
                <h3 id="pro-upsell-title">Meet Tabox Pro</h3>
                <p>Work smarter. Share anything.</p>
            </div>

            <div className="pro-upsell-benefits">
                <article className="pro-upsell-benefit pro-upsell-benefit--ai">
                    <span className="pro-upsell-benefit-icon" aria-hidden="true"><MdAutoAwesome /></span>
                    <div className="pro-upsell-benefit-copy">
                        <span className="pro-upsell-benefit-label">AI powered</span>
                        <h4>Organize tabs in seconds</h4>
                        <p>Auto-rename, smart group, split duplicates, and arrange collections with AI.</p>
                    </div>
                </article>
                <article className="pro-upsell-benefit pro-upsell-benefit--share">
                    <span className="pro-upsell-benefit-icon" aria-hidden="true"><MdFolderShared /></span>
                    <div className="pro-upsell-benefit-copy">
                        <span className="pro-upsell-benefit-label">Share &amp; collaborate</span>
                        <h4>Share folders &amp; collections</h4>
                        <p>Send a clean link to any saved workspace and keep everyone aligned.</p>
                    </div>
                </article>
            </div>

            <div className="pro-upsell-offer" aria-label="Free trial terms">
                <strong>7 days free</strong>
                <span aria-hidden="true">•</span>
                <strong>Cancel anytime</strong>
            </div>

            {sessionExpired ? (
                <>
                    <div className="pro-upsell-session-expired" role="alert">
                        Your session expired — sign in again to restore your Tabox Pro access.
                    </div>
                    <button type="button" className="pro-upsell-cta" onClick={handleReSignIn}>Sign in again</button>
                </>
            ) : isSignedIn ? (
                <button type="button" className="pro-upsell-cta" onClick={onUpgrade}>Start my free 7-day trial</button>
            ) : (
                <button type="button" className="pro-upsell-cta" onClick={onSignIn}>Sign in with Google to start</button>
            )}
        </section>
    );
}
