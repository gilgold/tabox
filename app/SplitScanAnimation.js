import React from 'react';
import './SplitScanAnimation.css';

// Scan animation for Split Collection: a source collection full of tabs. A
// group of tabs highlights and flies sideways; once it lands, a collection card
// frame fades in *behind those same tabs* — forming them into a sub-collection.
// First a group goes left, then a group goes right. Every keyframe track ends
// where it starts (opacity 0 / base transform) so the loop is seamless.
// Compositor-friendly: only transform + opacity animate.
function SplitScanAnimation() {
    return (
        <div className="split-scan" role="img" aria-label="Scanning collection and forming sub-collections">
            <div className="split-scan-stage" aria-hidden="true">
                {/* The source collection — always present, centered. */}
                <div className="ssc-source">
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                </div>

                {/* A tab group that flies left; its frame forms behind it on landing. */}
                <div className="ssc-fly ssc-fly--left">
                    <span className="ssc-frame" />
                    <span className="ssc-fly-row" />
                    <span className="ssc-fly-row" />
                </div>
                {/* A tab group that flies right; its frame forms behind it on landing. */}
                <div className="ssc-fly ssc-fly--right">
                    <span className="ssc-frame" />
                    <span className="ssc-fly-row" />
                    <span className="ssc-fly-row" />
                </div>
            </div>
        </div>
    );
}

export default SplitScanAnimation;
