import React from 'react';
import './SmartOrganizeFoldAnimation.css';

const BrowserTab = ({ className, iconClassName }) => (
    <span
        className={`so-browser-tab ${className}`}
        data-testid="smart-grouping-tab"
    >
        <span className={`so-tab-favicon ${iconClassName}`} />
        <span className="so-tab-title" />
    </span>
);

// Purely-decorative browser-chrome animation shown while Smart Tab Grouping
// runs. Six loose tabs settle into two Chrome-style color groups, then fan
// back out for the next pass. CSS-only; reduced-motion and performance mode
// keep the final grouped arrangement static.
function SmartOrganizeFoldAnimation() {
    return (
        <div
            className="so-fold-anim"
            aria-hidden="true"
            data-testid="smart-grouping-browser-animation"
        >
            <div className="so-browser-window">
                <div className="so-browser-tab-strip">
                    <div
                        className="so-tab-group so-tab-group--blue"
                        data-testid="smart-grouping-group"
                    >
                        <span className="so-tab-group-label">
                            <span className="so-tab-group-dot" />
                            Work
                        </span>
                        <BrowserTab className="so-browser-tab--1" iconClassName="so-tab-favicon--docs" />
                        <BrowserTab className="so-browser-tab--2" iconClassName="so-tab-favicon--mail" />
                        <BrowserTab className="so-browser-tab--3" iconClassName="so-tab-favicon--calendar" />
                    </div>
                    <div
                        className="so-tab-group so-tab-group--rose"
                        data-testid="smart-grouping-group"
                    >
                        <span className="so-tab-group-label">
                            <span className="so-tab-group-dot" />
                            Read
                        </span>
                        <BrowserTab className="so-browser-tab--4" iconClassName="so-tab-favicon--news" />
                        <BrowserTab className="so-browser-tab--5" iconClassName="so-tab-favicon--video" />
                        <BrowserTab className="so-browser-tab--6" iconClassName="so-tab-favicon--notes" />
                    </div>
                </div>
                <div className="so-browser-toolbar">
                    <span className="so-browser-control so-browser-control--back" />
                    <span className="so-browser-control so-browser-control--forward" />
                    <span className="so-browser-control so-browser-control--reload" />
                    <span className="so-browser-address">
                        <span className="so-browser-lock" />
                        tabox.co
                    </span>
                </div>
            </div>
        </div>
    );
}

export default SmartOrganizeFoldAnimation;
