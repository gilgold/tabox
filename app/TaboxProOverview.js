import React from 'react';
import { BsStars } from 'react-icons/bs';
import { MdCheck, MdFolderShared, MdVerifiedUser, MdWorkspacePremium } from 'react-icons/md';
import './TaboxProOverview.css';

const BENEFITS = [
    {
        title: 'Organize with AI',
        description: 'Smart grouping, auto-rename, auto-arrange, duplicate sweep, and collection splitting.',
        icon: BsStars,
        tone: 'ai',
    },
    {
        title: 'Share anything',
        description: 'Share individual collections or entire folders.',
        icon: MdFolderShared,
        tone: 'share',
    },
    {
        title: 'Stay in control',
        description: 'Your existing collections stay yours. Cancel anytime.',
        icon: MdVerifiedUser,
        tone: 'control',
    },
];

export default function TaboxProOverview({ statusLabel, onUpgrade }) {
    return (
        <section className="fp-pro-overview" aria-labelledby="fp-pro-overview-title">
            <section className="fp-settings-plan-details fp-pro-status-pill" aria-label={`Current plan: ${statusLabel}`}>
                <MdWorkspacePremium aria-hidden="true" />
                <span className="fp-pro-visually-hidden">Current plan</span>
                <strong>{statusLabel}</strong>
            </section>

            <div className="fp-pro-overview-layout">
                <div className="fp-pro-benefits">
                    <h4 id="fp-pro-overview-title">Upgrade your tab workflow</h4>
                    <ul className="fp-pro-benefit-list">
                        {BENEFITS.map(({ title, description, icon: BenefitIcon, tone }) => (
                            <li className="fp-pro-benefit" key={title}>
                                <span className={`fp-pro-benefit-icon is-${tone}`} aria-hidden="true">
                                    <BenefitIcon />
                                </span>
                                <span className="fp-pro-benefit-copy">
                                    <strong>{title}</strong>
                                    <span>{description}</span>
                                </span>
                                <span className="fp-pro-benefit-check" aria-hidden="true">
                                    <MdCheck />
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                <aside className="fp-pro-offer-card" aria-label="Tabox Pro pricing">
                    <div className="fp-pro-offer-icon" aria-hidden="true">
                        <MdWorkspacePremium />
                    </div>
                    <h4>7 days free</h4>

                    <div className="fp-pro-pricing">
                        <div className="fp-pro-prices">
                            <div className="fp-pro-price">
                                <strong>Monthly</strong>
                                <span>$5.99 / month</span>
                            </div>
                            <div className="fp-pro-price">
                                <span className="fp-pro-savings">2 months free!</span>
                                <strong>Yearly</strong>
                                <span>$59.99 / year</span>
                            </div>
                        </div>
                    </div>

                    <button type="button" className="menu-button fp-settings-menu-button fp-pro-upgrade-button" onClick={onUpgrade}>
                        <MdWorkspacePremium aria-hidden="true" />
                        Upgrade — start free 7-day trial
                    </button>

                    <div className="fp-pro-offer-note">
                        <span>Continue to the Tabox Pro upgrade page</span>
                        <span>Cancel anytime</span>
                    </div>
                </aside>
            </div>
        </section>
    );
}
