import React from 'react';
import './SplitCollectionToolIcon.css';

// Animated icon for the "Split a collection" AI tool card.
// Static state: one large collection card with a split (fork) glyph inside it.
// On card hover it plays once: the glyph fades out and the card divides into
// two cards that slide apart, side by side. The split halves are hidden at
// rest (the single base card + glyph is shown), so it reads as one card until
// it splits, then holds split while hovering and resets on mouse-out. CSS-only
// (transform/opacity, compositor-friendly); degrades to the static state under
// prefers-reduced-motion / performance mode. Decorative only.
function SplitCollectionToolIcon({ className = '' }) {
    return (
        <svg
            className={`sl-svg ${className}`.trim()}
            width="58"
            height="44"
            viewBox="0 0 40 30"
            fill="none"
            aria-hidden="true"
        >
            {/* The single large collection card (shown at rest) — taller than
                wide so it reads as a card, not a square. */}
            <g className="sl-base">
                <rect className="sl-card" x="8.5" y="3" width="23" height="24" rx="2.5" />
            </g>
            {/* The two result cards (hidden at rest; slide apart on hover) */}
            <g className="sl-half sl-left">
                <rect className="sl-card" x="8.5" y="3" width="11.5" height="24" rx="2.5" />
            </g>
            <g className="sl-half sl-right">
                <rect className="sl-card" x="20" y="3" width="11.5" height="24" rx="2.5" />
            </g>
            {/* Split (fork) glyph inside the card — two diverging arrows that
                fade out as the card splits. */}
            <path
                className="sl-icon"
                d="M20 20 L20 15 M20 15 L14 10 M20 15 L26 10 M14 10 L17 10.3 M14 10 L14.8 12.9 M26 10 L23 10.3 M26 10 L25.2 12.9"
            />
        </svg>
    );
}

export default SplitCollectionToolIcon;
