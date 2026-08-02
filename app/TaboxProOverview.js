import React from 'react';
import { BsStars } from 'react-icons/bs';
import { MdArrowForward, MdCheck, MdFolderShared, MdVerifiedUser, MdWorkspacePremium } from 'react-icons/md';
import './TaboxProOverview.css';

const BENEFITS = [
    {
        title: 'Organize with AI',
        description: 'Smart grouping, auto-rename, auto-arrange, duplicate sweep, and collection splitting.',
        compactDescription: 'Group, rename & clean up',
        icon: BsStars,
        tone: 'ai',
    },
    {
        title: 'Share anything',
        description: 'Share individual collections or entire folders.',
        compactDescription: 'Collections and folders',
        icon: MdFolderShared,
        tone: 'share',
    },
    {
        title: 'Stay in control',
        description: 'Your existing collections stay yours. Cancel anytime.',
        compactDescription: 'Your data stays yours',
        icon: MdVerifiedUser,
        tone: 'control',
    },
];

export default function TaboxProOverview({ statusLabel, onUpgrade, compact = false }) {
    const benefits = (
        <div className="fp-pro-benefits">
            <h4 id="fp-pro-overview-title">{compact ? 'Everything included' : 'Upgrade your tab workflow'}</h4>
            <ul className="fp-pro-benefit-list">
                {BENEFITS.map(({ title, description, compactDescription, icon: BenefitIcon, tone }) => (
                    <li className="fp-pro-benefit" key={title}>
                        <span className={`fp-pro-benefit-icon is-${tone}`} aria-hidden="true">
                            <BenefitIcon />
                        </span>
                        <span className="fp-pro-benefit-copy">
                            <strong>{title}</strong>
                            <span>{compact ? compactDescription : description}</span>
                        </span>
                        <span className="fp-pro-benefit-check" aria-hidden="true">
                            <MdCheck />
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );

    const offer = (
        <aside className="fp-pro-offer-card" aria-label="Tabox Pro pricing">
            <div className="fp-pro-offer-icon" aria-hidden="true">
                <MdWorkspacePremium />
            </div>
            <span className="fp-pro-offer-kicker">Try Tabox Pro</span>
            <h4>7 days free</h4>

            <div className="fp-pro-pricing">
                <div className="fp-pro-prices">
                    <div className="fp-pro-price is-monthly">
                        <strong>Monthly</strong>
                        <span>$5.99 / month</span>
                    </div>
                    <div className="fp-pro-price is-yearly">
                        <span className="fp-pro-savings">2 months free!</span>
                        <strong>Yearly</strong>
                        <span>$59.99 / year</span>
                    </div>
                </div>
            </div>

            <button type="button" className="menu-button fp-settings-menu-button fp-pro-upgrade-button" onClick={onUpgrade}>
                <MdWorkspacePremium aria-hidden="true" />
                <span>{compact ? 'Start free 7-day trial' : 'Upgrade — start free 7-day trial'}</span>
                <MdArrowForward className="fp-pro-upgrade-arrow" aria-hidden="true" />
            </button>

            <div className="fp-pro-offer-note">
                <span>{compact ? 'No charge today' : 'Continue to the Tabox Pro upgrade page'}</span>
                <span>Cancel anytime</span>
            </div>
        </aside>
    );

    return (
        <section className={`fp-pro-overview${compact ? ' fp-pro-overview--compact' : ''}`} aria-labelledby="fp-pro-overview-title">
            <section className="fp-settings-plan-details fp-pro-status-pill" aria-label={`Current plan: ${statusLabel}`}>
                <MdWorkspacePremium aria-hidden="true" />
                <span className="fp-pro-visually-hidden">Current plan</span>
                <strong>{statusLabel}</strong>
            </section>

            <div className="fp-pro-overview-layout">
                {compact ? offer : benefits}
                {compact ? benefits : offer}
            </div>
        </section>
    );
}
