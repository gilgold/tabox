import React from 'react';
import './AutoArrangeToolIcon.css';

// Animated icon for the "Auto arrange into folders" AI tool card. Mirrors the
// run-time AutoArrangeFoldAnimation metaphor in miniature: loose collection
// cards on the left fly into folder rows on the right, each folder giving a
// little receive-bump as its card lands. Static state: cards resting beside
// their folders, so "collections → folders" still reads. On card hover it
// plays once. CSS-only (transform/opacity, compositor-friendly); degrades to
// the static state under prefers-reduced-motion / performance mode.
// Decorative only.
function AutoArrangeToolIcon({ className = '' }) {
    return (
        <svg
            className={`aa-svg ${className}`.trim()}
            width="48"
            height="36"
            viewBox="0 0 40 30"
            fill="none"
            aria-hidden="true"
        >
            {/* Destination folders (right column) */}
            <g className="aa-folder aa-folder--a">
                <path className="aa-folder-body" d="M24 3 L30 3 L31.5 5 L38 5 L38 13 L24 13 Z" />
                <line className="aa-folder-rim" x1="24" y1="9" x2="38" y2="9" />
            </g>
            <g className="aa-folder aa-folder--b">
                <path className="aa-folder-body" d="M24 16 L30 16 L31.5 18 L38 18 L38 26 L24 26 Z" />
                <line className="aa-folder-rim" x1="24" y1="22" x2="38" y2="22" />
            </g>
            {/* Collections in flight (left column) — fly right into the folders */}
            <rect className="aa-card aa-card--a" x="3" y="5" width="12" height="6" rx="1.5" />
            <rect className="aa-card aa-card--b" x="3" y="18" width="12" height="6" rx="1.5" />
        </svg>
    );
}

export default AutoArrangeToolIcon;
