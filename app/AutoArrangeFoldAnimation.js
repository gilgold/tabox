import React from 'react';
import './AutoArrangeFoldAnimation.css';

// Purely-decorative 2D animation shown while Auto-Arrange runs: loose collection
// cards slide down and drop into a folder, on a loop. CSS-only (transform/opacity,
// compositor-friendly); degrades to a static filed state under
// prefers-reduced-motion / performance mode. aria-hidden — decorative only.
function AutoArrangeFoldAnimation() {
    return (
        <div className="aa-fold-anim" aria-hidden="true">
            <div className="aa-fold-stage">
                <span className="aa-fold-card aa-fold-card--1" />
                <span className="aa-fold-card aa-fold-card--2" />
                <span className="aa-fold-card aa-fold-card--3" />
                <div className="aa-fold-folder">
                    <span className="aa-fold-folder-tab" />
                    <span className="aa-fold-folder-body" />
                </div>
            </div>
        </div>
    );
}

export default AutoArrangeFoldAnimation;
