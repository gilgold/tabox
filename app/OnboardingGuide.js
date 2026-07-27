import React, { useCallback, useEffect, useState } from 'react';
import {
    MdArrowBack,
    MdArrowForward,
    MdAutoAwesome,
    MdCheck,
    MdClose,
    MdFolder,
    MdFolderShared,
    MdFullscreen,
    MdOpenInNew,
    MdOutlineDragIndicator,
    MdPerson,
    MdSearch,
    MdStar,
    MdTab,
} from 'react-icons/md';
import { browser } from '../static/globals';
import useProCheckout from './useProCheckout';
import './OnboardingGuide.css';

const ONBOARDING_ELIGIBLE_KEY = 'onboardingEligible';
const ONBOARDING_COMPLETED_KEY = 'onboardingCompleted';
// TEMPORARY TESTING SWITCH: set to false before release to restore the
// fresh-install-only storage gate below.
const FORCE_ONBOARDING_FOR_POPUP_TESTING = false;

function WelcomeScene({ active }) {
    return (
        <div className={`onboarding-scene welcome-scene${active ? ' is-active' : ''}`} aria-hidden="true">
            <div className="welcome-browser-frame">
                <div className="browser-window-controls"><i /><i /><i /></div>
                <div className="browser-tab-row">
                    {['Docs', 'Mail', 'Design', 'Tasks', 'Ideas'].map((label, index) => (
                        <span className={`browser-row-tab browser-row-tab-${index + 1}`} key={label}><i />{label}</span>
                    ))}
                </div>
                <div className="browser-page-lines"><i /><i /><i /></div>
            </div>
            <div className="welcome-saved-box"><MdFolder /><strong>Project tabs</strong><span>5 tabs saved</span><MdCheck className="welcome-saved-check" /></div>
            <div className="welcome-tabox-ui">
                <div className="welcome-tabox-header"><strong>Tabox</strong><span>Collections</span></div>
                <div className="welcome-tabox-search"><MdSearch /></div>
            </div>
        </div>
    );
}

function SaveScene({ active }) {
    return (
        <div className={`onboarding-scene save-scene${active ? ' is-active' : ''}`} aria-hidden="true">
            <div className="save-demo-shell">
                <div className="save-demo-input">
                    <MdSearch />
                    <span className="save-typed-text">Project launch</span>
                    <span className="save-demo-caret" />
                    <span className="save-demo-button">Save</span>
                </div>
                <div className="save-demo-list">
                    <div className="save-list-card save-list-created"><i />Project launch <MdCheck /></div>
                    <div className="save-list-card save-list-existing card-reading"><i />Reading list</div>
                    <div className="save-list-card save-list-existing card-weekend"><i />Weekend ideas</div>
                </div>
                <div className="save-demo-label label-save">Name + save</div>
                <div className="save-demo-label label-search"><MdSearch /> Type again to search</div>
            </div>
        </div>
    );
}

function CollectionScene({ active }) {
    return (
        <div className={`onboarding-scene collection-scene${active ? ' is-active' : ''}`} aria-hidden="true">
            <div className="collection-demo-card">
                <div className="collection-demo-header">
                    <span className="collection-demo-dot" />
                    <strong>Design research</strong>
                    <MdOpenInNew />
                </div>
                <div className="collection-demo-tabs">
                    <div className="reorder-row row-inspiration"><MdOutlineDragIndicator /><span /> Inspiration</div>
                    <div className="reorder-row row-components"><MdOutlineDragIndicator /><span /> Components</div>
                    <div className="reorder-row row-notes"><MdOutlineDragIndicator /><span /> Notes</div>
                </div>
                <div className="open-all-demo"><MdTab /> Open all tabs</div>
            </div>
            <span className="demo-pointer collection-pointer" />
        </div>
    );
}

function OrganizeScene({ active }) {
    return (
        <div className={`onboarding-scene organize-scene${active ? ' is-active' : ''}`} aria-hidden="true">
            <div className="organize-tabox-window">
                <div className="organize-tabox-header">
                    <strong>Tabox</strong>
                    <span>Colors</span>
                    <div className="organize-palette"><i /><i /><i /><i /></div>
                </div>
                <div className="organize-tabox-content">
                    <div className="organize-folder-row organize-color-item">
                        <MdFolder />
                        <span><strong>Creative work</strong><small>3 collections</small></span>
                        <b>⌄</b>
                    </div>
                    <div className="organize-folder-collections">
                        <div className="organize-collection-row organize-collection-one organize-color-item">
                            <i className="organize-collection-swatch" />
                            <span><strong>Design research</strong><small>8 tabs</small></span>
                            <MdStar className="organize-muted-star" />
                        </div>
                        <div className="organize-collection-row organize-collection-two organize-color-item">
                            <i className="organize-collection-swatch" />
                            <span><strong>Inspiration</strong><small>12 tabs</small></span>
                            <MdStar className="organize-favorite-star" />
                        </div>
                        <div className="organize-collection-row organize-collection-three organize-color-item">
                            <i className="organize-collection-swatch" />
                            <span><strong>Launch assets</strong><small>5 tabs</small></span>
                            <MdStar className="organize-muted-star" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function FullPageScene({ active }) {
    return (
        <div className={`onboarding-scene fullpage-scene${active ? ' is-active' : ''}`} aria-hidden="true">
            <div className="morphing-window">
                <div className="morphing-header">
                    <strong>Tabox</strong>
                    <span className="popup-fullpage-button"><MdFullscreen /></span>
                </div>
                <div className="morphing-body">
                    <aside className="morphing-sidebar"><b /><b /><b /><b /></aside>
                    <main className="morphing-content">
                        <div className="morphing-search" />
                        <div className="morphing-grid"><i /><i /><i /><i /><i /><i /></div>
                    </main>
                </div>
            </div>
            <span className="demo-pointer fullpage-pointer" />
        </div>
    );
}

function ProScene({ active }) {
    return (
        <div className={`onboarding-scene pro-scene${active ? ' is-active' : ''}`} aria-hidden="true">
            <div className="sharing-users">
                <div className="sharing-user sharing-user-one"><span><MdPerson /></span><strong>Maya</strong></div>
                <div className="sharing-user sharing-user-two"><span><MdPerson /></span><strong>Alex</strong></div>
                <div className="sharing-user sharing-user-three"><span><MdPerson /></span><strong>Sam</strong></div>
            </div>
                <div className="shared-folder-fullview">
                    <div className="shared-folder-heading"><MdFolderShared /><strong>Team research</strong><small>Shared folder</small></div>
                    <div className="shared-folder-collections">
                        <div className="shared-arriving-collection shared-arriving-one"><i />Launch plan<small>Added by Maya</small></div>
                        <div className="shared-arriving-collection shared-arriving-two"><i />Research<small>Added by Alex</small></div>
                        <div className="shared-arriving-collection shared-arriving-three"><i />Inspiration<small>Added by Sam</small></div>
                    </div>
                </div>
        </div>
    );
}

const STEPS = [
    {
        eyebrow: 'Welcome to Tabox',
        title: 'Your tabs, finally under control.',
        body: 'Save the windows you care about, keep them beautifully organized, and return whenever you are ready.',
        Scene: WelcomeScene,
    },
    {
        eyebrow: 'Save & search',
        title: 'Save now. Find anything later.',
        body: 'In the popup, one box does both: type a new collection name and save, or type to instantly search everything you already have.',
        Scene: SaveScene,
    },
    {
        eyebrow: 'Your collections',
        title: 'Collections stay flexible',
        body: 'Open a collection to see its tabs, drag tabs into the order you want, or open all tabs together with one click.',
        Scene: CollectionScene,
    },
    {
        eyebrow: 'Make it yours',
        title: 'Build a system that feels like yours',
        body: 'Group collections into folders, assign colors for quick recognition, and star the collections you want close at hand.',
        Scene: OrganizeScene,
    },
    {
        eyebrow: 'Full-page view',
        title: 'More room when you need it',
        body: 'Open the full-page view for a spacious workspace built for browsing, sorting, and managing larger tab libraries.',
        Scene: FullPageScene,
    },
    {
        eyebrow: 'Optional upgrade',
        title: 'Meet Tabox Pro',
        body: 'Go further with premium tools, or keep using the complete free experience. The choice is always yours.',
        Scene: ProScene,
        isPro: true,
    },
];

export default function OnboardingGuide({ mode = 'popup' }) {
    const [isOpen, setIsOpen] = useState(
        FORCE_ONBOARDING_FOR_POPUP_TESTING && mode === 'popup'
    );
    const [step, setStep] = useState(0);
    const [sceneRun, setSceneRun] = useState(0);
    const startProCheckout = useProCheckout();

    const goToStep = useCallback((nextStep) => {
        setStep(Math.max(0, Math.min(STEPS.length - 1, nextStep)));
        setSceneRun((current) => current + 1);
    }, []);

    useEffect(() => {
        if (mode !== 'popup') return undefined;
        if (FORCE_ONBOARDING_FOR_POPUP_TESTING) return undefined;

        let cancelled = false;
        browser.storage.local.get([ONBOARDING_ELIGIBLE_KEY, ONBOARDING_COMPLETED_KEY])
            .then((data) => {
                if (!cancelled && data?.[ONBOARDING_ELIGIBLE_KEY] === true && data?.[ONBOARDING_COMPLETED_KEY] !== true) {
                    setIsOpen(true);
                }
            })
            .catch((error) => console.warn('Unable to load onboarding state:', error));

        return () => { cancelled = true; };
    }, [mode]);

    const complete = useCallback(async () => {
        setIsOpen(false);
        await browser.storage.local.set({
            [ONBOARDING_ELIGIBLE_KEY]: false,
            [ONBOARDING_COMPLETED_KEY]: true,
        });
    }, []);

    const choosePro = async () => {
        await complete();
        await startProCheckout({ ensureLogin: true });
    };

    if (!isOpen) return null;

    return (
        <div className="onboarding-overlay">
            <section
                className="onboarding-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Welcome to Tabox"
            >
                <button type="button" className="onboarding-skip" onClick={complete} aria-label="Skip onboarding">
                    Skip <MdClose aria-hidden="true" />
                </button>

                <div className="onboarding-viewport">
                    <div className="onboarding-scene-frame">
                        <div className="onboarding-scene-track" style={{ transform: `translate3d(-${step * 100}%, 0, 0)` }}>
                            {STEPS.map(({ Scene }, index) => (
                                <Scene
                                    active={index === step}
                                    key={index === step ? `${index}-${sceneRun}` : `${index}-idle`}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="onboarding-copy-viewport">
                        <div className="onboarding-track" style={{ transform: `translate3d(-${step * 100}%, 0, 0)` }}>
                            {STEPS.map(({ eyebrow, title, body, isPro }, index) => (
                                <article
                                    className={`onboarding-slide${isPro ? ' onboarding-slide--pro' : ''}`}
                                    key={title}
                                    aria-hidden={index !== step}
                                >
                                    <div className="onboarding-copy">
                                        <span className="onboarding-eyebrow">{eyebrow}</span>
                                        <h2 id={index === 0 ? 'onboarding-welcome-title' : undefined}>{title}</h2>
                                        <p>{body}</p>
                                        {isPro && (
                                            <>
                                                <strong className="onboarding-trial-badge">7 days free</strong>
                                                <div className="onboarding-pro-features">
                                                    <span><MdAutoAwesome /> Tabox AI</span>
                                                    <span><MdFolderShared /> Share folders &amp; collections</span>
                                                    <span><MdTab /> Tab switcher</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
                    {STEPS.map((item, index) => (
                        <button
                            type="button"
                            className={`onboarding-progress-dot${index === step ? ' active' : ''}`}
                            key={item.title}
                            onClick={() => goToStep(index)}
                            aria-label={`Go to step ${index + 1}`}
                            aria-current={index === step ? 'step' : undefined}
                        />
                    ))}
                </div>

                {step < STEPS.length - 1 ? (
                    <div className="onboarding-actions">
                        <button
                            type="button"
                            className="onboarding-back"
                            onClick={() => goToStep(step - 1)}
                            disabled={step === 0}
                            aria-label="Back"
                        >
                            <MdArrowBack />
                        </button>
                        <button type="button" className="onboarding-primary" onClick={() => goToStep(step + 1)}>
                            Next <MdArrowForward />
                        </button>
                    </div>
                ) : (
                    <div className="onboarding-actions onboarding-final-actions">
                        <button type="button" className="onboarding-free" onClick={complete}>
                            Continue for free
                        </button>
                        <button type="button" className="onboarding-primary onboarding-pro-cta" onClick={choosePro}>
                            <span>Start 7-day free trial</span>
                            <small>Then choose a Pro plan</small>
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}

export { ONBOARDING_ELIGIBLE_KEY, ONBOARDING_COMPLETED_KEY };
