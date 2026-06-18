import React from 'react';
import './SplitScanAnimation.css';

// Scan animation for Split Collection: a source collection full of tabs. A
// group of tabs highlights and flies left, with a new collection card forming
// behind it; then another group flies right and forms a second collection. The
// loop's end frame matches its start for a seamless endless feel.
function SplitScanAnimation() {
    return (
        <div className="split-scan" role="img" aria-label="Scanning collection and forming sub-collections">
            <div className="split-scan-stage" aria-hidden="true">
                {/* Sub-collections that form as each tab group flies out */}
                <div className="ssc-formed ssc-formed--left">
                    <span className="ssc-formed-row" />
                    <span className="ssc-formed-row" />
                </div>
                <div className="ssc-formed ssc-formed--right">
                    <span className="ssc-formed-row" />
                    <span className="ssc-formed-row" />
                </div>

                {/* The source collection (always present) */}
                <div className="ssc-source">
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                    <span className="ssc-row" />
                </div>

                {/* Highlighted tab group peeling off to the left */}
                <div className="ssc-fly ssc-fly--left">
                    <span className="ssc-fly-row" />
                    <span className="ssc-fly-row" />
                </div>
                {/* Highlighted tab group peeling off to the right */}
                <div className="ssc-fly ssc-fly--right">
                    <span className="ssc-fly-row" />
                    <span className="ssc-fly-row" />
                </div>
            </div>
        </div>
    );
}

export default SplitScanAnimation;
