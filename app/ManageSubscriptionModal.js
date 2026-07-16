import React, { useState, useEffect } from 'react';
import Modal from 'react-modal';
import { useAtom } from 'jotai';
import { MdClose, MdWorkspacePremium, MdOpenInNew } from 'react-icons/md';
import { browser } from '../static/globals';
import { manageSubscriptionOpenState } from './atoms/premiumState';
import { showSuccessToast } from './toastHelpers';
import './Modal.css';
import './ManageSubscriptionModal.css';

// Paddle amounts are strings in the currency's lowest unit.
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'CLP', 'VND']);
export function formatAmount(amount, currency) {
    const value = Number(amount);
    if (!Number.isFinite(value) || !currency) return null;
    const major = ZERO_DECIMAL_CURRENCIES.has(currency) ? value : value / 100;
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
    } catch {
        return `${major} ${currency}`;
    }
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : null);

const ERROR_MESSAGES = {
    not_signed_in: 'Please sign in to Tabox sync to manage your subscription.',
    network_error: 'Could not reach the Tabox server. Check your connection and try again.',
    no_subscription: 'No active subscription was found for this account.',
};
const errorMessage = (result) =>
    ERROR_MESSAGES[result?.error] ||
    result?.detail ||
    `Something went wrong${result?.error ? ` (${result.error})` : ''}. Please try again.`;

export function ManageSubscriptionControls({ active = true, onBack, onBusyChange }) {
    const [subscription, setSubscription] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    // 'main' | 'confirm-cancel' | 'confirm-switch'
    const [view, setView] = useState('main');
    const [preview, setPreview] = useState(null);

    const loadSubscription = async () => {
        setLoading(true);
        setError(null);
        const result = await browser.runtime.sendMessage({ type: 'proGetSubscription' });
        if (result?.ok) {
            setSubscription(result.data);
        } else {
            setError(errorMessage(result));
        }
        setLoading(false);
    };

    useEffect(() => {
        if (active) {
            setSubscription(null);
            setView('main');
            setPreview(null);
            setError(null);
            loadSubscription();
        }
    }, [active]);

    useEffect(() => {
        onBusyChange?.(busy);
    }, [busy, onBusyChange]);

    if (!active) return null;

    const targetPlan = subscription?.plan === 'annual' ? 'monthly' : 'annual';
    const cancelScheduled = subscription?.scheduled_change?.action === 'cancel';
    const periodEnd = formatDate(subscription?.scheduled_change?.effective_at || subscription?.current_period_end);
    const renewalDate = formatDate(subscription?.next_billed_at);

    const runAction = async (message, { successToast, backToMain = true } = {}) => {
        setBusy(true);
        setError(null);
        const result = await browser.runtime.sendMessage(message);
        if (result?.ok) {
            if (successToast) showSuccessToast(successToast);
            if (backToMain) {
                setView('main');
                setPreview(null);
            }
            setSubscription(result.data && result.data.status ? result.data : subscription);
            await loadSubscription();
        } else {
            setError(errorMessage(result));
        }
        setBusy(false);
    };

    const startSwitch = async () => {
        setBusy(true);
        setError(null);
        const result = await browser.runtime.sendMessage({ type: 'proChangePlan', plan: targetPlan, preview: true });
        if (result?.ok) {
            setPreview(result.data);
            setView('confirm-switch');
        } else {
            setError(errorMessage(result));
        }
        setBusy(false);
    };

    const confirmSwitch = () =>
        runAction(
            { type: 'proChangePlan', plan: targetPlan },
            { successToast: `You're now on the ${targetPlan} plan!` }
        );

    const confirmCancel = () =>
        runAction({ type: 'proCancelSubscription' }, { successToast: 'Subscription cancelled' });

    const resume = () =>
        runAction({ type: 'proResumeSubscription' }, { successToast: 'Subscription resumed!' });

    const immediateCharge =
        preview?.immediate?.action === 'charge' ? formatAmount(preview.immediate.amount, preview.immediate.currency) : null;
    const recurringAmount = preview?.recurring ? formatAmount(preview.recurring.amount, preview.recurring.currency) : null;

    return (
        <div className={`manage-sub-controls${onBack ? ' manage-sub-controls-inline' : ''}`}>
            {onBack && (
                <div className="manage-sub-inline-header">
                    <div>
                        <h4>Manage subscription</h4>
                        <p>Review billing details or make changes to your Tabox Pro plan.</p>
                    </div>
                    <button className="manage-sub-back" onClick={onBack} type="button" disabled={busy}>
                        Back to plan overview
                    </button>
                </div>
            )}

            <div className="manage-sub-body">
                    {loading && <div className="manage-sub-loading">Loading your subscription…</div>}

                    {!loading && subscription && view === 'main' && (
                        <>
                            <div className="manage-sub-summary">
                                <div className="manage-sub-row">
                                    <span className="manage-sub-label">Plan</span>
                                    <span className="manage-sub-value">
                                        Tabox Pro — {subscription.plan === 'annual' ? 'annual' : 'monthly'}
                                    </span>
                                </div>
                                <div className="manage-sub-row">
                                    <span className="manage-sub-label">Status</span>
                                    <span className="manage-sub-value">{subscription.status}</span>
                                </div>
                                {cancelScheduled ? (
                                    <div className="manage-sub-row">
                                        <span className="manage-sub-label">Ends on</span>
                                        <span className="manage-sub-value">{periodEnd}</span>
                                    </div>
                                ) : renewalDate ? (
                                    <div className="manage-sub-row">
                                        <span className="manage-sub-label">Renews on</span>
                                        <span className="manage-sub-value">{renewalDate}</span>
                                    </div>
                                ) : null}
                            </div>

                            {cancelScheduled ? (
                                <>
                                    <div className="manage-sub-notice">
                                        Your subscription is set to cancel. You keep Tabox Pro until {periodEnd}.
                                    </div>
                                    <button type="button" className="manage-sub-btn manage-sub-btn-primary" onClick={resume} disabled={busy}>
                                        {busy ? 'Resuming…' : 'Resume subscription'}
                                    </button>
                                </>
                            ) : (
                                <div className="manage-sub-plan-actions">
                                    <button type="button" className="manage-sub-btn manage-sub-btn-primary" onClick={startSwitch} disabled={busy}>
                                        {busy ? 'Checking price…' : `Switch to ${targetPlan} billing`}
                                    </button>
                                    <button
                                        type="button"
                                        className="manage-sub-btn manage-sub-btn-danger"
                                        onClick={() => { setError(null); setView('confirm-cancel'); }}
                                        disabled={busy}
                                    >
                                        Cancel subscription
                                    </button>
                                </div>
                            )}

                            {subscription.update_payment_method_url && (
                                <a
                                    className="manage-sub-link"
                                    href={subscription.update_payment_method_url}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Update payment method <MdOpenInNew size={12} />
                                </a>
                            )}
                        </>
                    )}

                    {!loading && subscription && view === 'confirm-switch' && (
                        <>
                            <h4 className="manage-sub-confirm-title">Switch to {targetPlan} billing?</h4>
                            <ul className="manage-sub-confirm-details">
                                {immediateCharge ? (
                                    <li>You&apos;ll be charged <strong>{immediateCharge}</strong> today (prorated).</li>
                                ) : subscription.status === 'trialing' ? (
                                    <li>No charge today — your trial continues, and the {targetPlan} price applies when it ends.</li>
                                ) : (
                                    <li>No charge today — the change takes effect at your next renewal.</li>
                                )}
                                {recurringAmount && (
                                    <li>Then <strong>{recurringAmount}</strong> per {targetPlan === 'annual' ? 'year' : 'month'}.</li>
                                )}
                                {formatDate(preview?.next_billed_at) && (
                                    <li>Next billing date: <strong>{formatDate(preview.next_billed_at)}</strong>.</li>
                                )}
                            </ul>
                            <div className="manage-sub-actions">
                                <button type="button" className="manage-sub-btn" onClick={() => setView('main')} disabled={busy}>
                                    Back
                                </button>
                                <button type="button" className="manage-sub-btn manage-sub-btn-primary" onClick={confirmSwitch} disabled={busy}>
                                    {busy ? 'Switching…' : `Confirm switch`}
                                </button>
                            </div>
                        </>
                    )}

                    {!loading && subscription && view === 'confirm-cancel' && (
                        <>
                            <h4 className="manage-sub-confirm-title">Cancel your subscription?</h4>
                            <p className="manage-sub-confirm-text">
                                You&apos;ll keep Tabox Pro until <strong>{periodEnd || 'the end of your billing period'}</strong>.
                                No further charges after that. You can resume any time before then.
                            </p>
                            <div className="manage-sub-actions">
                                <button type="button" className="manage-sub-btn" onClick={() => setView('main')} disabled={busy}>
                                    Keep subscription
                                </button>
                                <button type="button" className="manage-sub-btn manage-sub-btn-danger" onClick={confirmCancel} disabled={busy}>
                                    {busy ? 'Cancelling…' : 'Cancel subscription'}
                                </button>
                            </div>
                        </>
                    )}

                    {error && <div className="manage-sub-error">{error}</div>}

                    {!loading && !subscription && error && (
                        <button type="button" className="manage-sub-btn" onClick={loadSubscription}>
                            Try again
                        </button>
                    )}
            </div>
        </div>
    );
}

function ManageSubscriptionModal() {
    const [isOpen, setIsOpen] = useAtom(manageSubscriptionOpenState);
    const [busy, setBusy] = useState(false);

    if (!isOpen) return null;

    const close = () => {
        if (!busy) setIsOpen(false);
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={close}
            contentLabel="Manage subscription"
            className="modal-content manage-subscription-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={!busy}
            shouldCloseOnEsc={!busy}
        >
            <div className="manage-sub-content">
                <div className="manage-sub-header">
                    <div className="manage-sub-title">
                        <MdWorkspacePremium size={20} />
                        <span>Manage subscription</span>
                    </div>
                    <button className="manage-sub-close" onClick={close} type="button" disabled={busy} aria-label="Close">
                        <MdClose />
                    </button>
                </div>
                <ManageSubscriptionControls active={isOpen} onBusyChange={setBusy} />
            </div>
        </Modal>
    );
}

export default ManageSubscriptionModal;
