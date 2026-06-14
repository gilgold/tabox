import React from 'react';
import './SmartOrganizeFoldAnimation.css';

// A small, purely-decorative 2D animation shown while Smart Organize runs:
// loose tab chips slide down and fold into a collapsed tab group. CSS-only
// (transform/opacity, compositor-friendly); degrades to a static grouped
// state under prefers-reduced-motion / performance mode.
function SmartOrganizeFoldAnimation() {
    return (
        <div className="so-fold-anim" aria-hidden="true">
            <div className="so-fold-stage">
                <span className="so-fold-tab so-fold-tab--1" />
                <span className="so-fold-tab so-fold-tab--2" />
                <span className="so-fold-tab so-fold-tab--3" />
                <div className="so-fold-group">
                    <span className="so-fold-group-dot" />
                    <span className="so-fold-group-label" />
                </div>
            </div>
        </div>
    );
}

export default SmartOrganizeFoldAnimation;
