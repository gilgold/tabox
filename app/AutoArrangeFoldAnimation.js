import React from 'react';
import './AutoArrangeFoldAnimation.css';

// Purely-decorative 2D animation shown while Auto-Arrange runs: collection cards
// fly in horizontally from the left, each landing in a different folder on the
// right (one collection → one folder, in turn). CSS-only (transform/opacity,
// compositor-friendly); degrades to a static filed state under
// prefers-reduced-motion / performance mode. aria-hidden — decorative only.
function AutoArrangeFoldAnimation() {
    return (
        <div className="aa-fly-anim" aria-hidden="true">
            <div className="aa-fly-stage">
                {/* Collections in flight — each targets a different folder row. */}
                <span className="aa-fly-card aa-fly-card--1" />
                <span className="aa-fly-card aa-fly-card--2" />
                <span className="aa-fly-card aa-fly-card--3" />

                {/* Destination folders (static anchors, pulse as a card lands). */}
                <div className="aa-folder aa-folder--1">
                    <span className="aa-folder-tab" />
                    <span className="aa-folder-front" />
                </div>
                <div className="aa-folder aa-folder--2">
                    <span className="aa-folder-tab" />
                    <span className="aa-folder-front" />
                </div>
                <div className="aa-folder aa-folder--3">
                    <span className="aa-folder-tab" />
                    <span className="aa-folder-front" />
                </div>
            </div>
        </div>
    );
}

export default AutoArrangeFoldAnimation;
