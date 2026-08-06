import React from 'react';
import './DuplicateSweepToolIcon.css';

// Animated icon for the "Duplicate-tab sweep" AI tool card.
// Static state: two identical cards — a duplicate pair. On card hover it plays
// once: a green check pops onto the card to keep and a red cross onto the
// duplicate, which then collapses away; the kept card gives a small confirming
// pulse before the scene resets. CSS-only (transform/opacity,
// compositor-friendly); degrades to the static state under
// prefers-reduced-motion / performance mode. Decorative only.
function DuplicateSweepToolIcon({ className = '' }) {
    return (
        <svg
            className={`ds-svg ${className}`.trim()}
            width="58"
            height="44"
            viewBox="0 0 40 30"
            fill="none"
            aria-hidden="true"
        >
            {/* Card to keep (left) */}
            <g className="ds-keep">
                <rect className="ds-card" x="2" y="7" width="15" height="16" rx="2" />
                <line className="ds-line" x1="5" y1="11" x2="13" y2="11" />
                <line className="ds-line" x1="5" y1="13.5" x2="10.8" y2="13.5" />
                <path className="ds-check" d="M6.5 17.5 L8.4 19.6 L13 14" />
            </g>
            {/* Duplicate to remove (right) */}
            <g className="ds-remove">
                <rect className="ds-card" x="23" y="7" width="15" height="16" rx="2" />
                <line className="ds-line" x1="26" y1="11" x2="34" y2="11" />
                <line className="ds-line" x1="26" y1="13.5" x2="31.8" y2="13.5" />
                <g className="ds-cross">
                    <line x1="27.8" y1="14.8" x2="33.2" y2="20.2" />
                    <line x1="33.2" y1="14.8" x2="27.8" y2="20.2" />
                </g>
            </g>
        </svg>
    );
}

export default DuplicateSweepToolIcon;
