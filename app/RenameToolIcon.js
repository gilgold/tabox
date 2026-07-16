import React from 'react';
import './RenameToolIcon.css';

// Animated icon for the "Auto rename collections" AI tool card.
// Static state: a text field with a written name and a pencil resting at the
// end — a recognizable "edit a name" glyph. On card hover it plays once: the
// pencil lifts off, flies to the start of the field, then sweeps left→right
// while the name's ink redraws beneath it, and settles back at rest.
// CSS-only (transform/opacity, compositor-friendly); degrades to the static
// state under prefers-reduced-motion / performance mode. Decorative only.
function RenameToolIcon({ className = '' }) {
    return (
        <svg
            className={`rf-svg ${className}`.trim()}
            width="48"
            height="36"
            viewBox="0 0 40 30"
            fill="none"
            aria-hidden="true"
        >
            {/* The "name" field */}
            <rect className="rf-box" x="3" y="8" width="29" height="15" rx="3.5" />
            {/* The written name (the ink the pencil lays down) */}
            <line className="rf-ink" x1="7" y1="18" x2="24" y2="18" />
            {/* The pencil — drawn upright, tilted into a writing pose, then
                positioned tip-down at the right end of the field. */}
            <g className="rf-pencil">
                <g transform="translate(25 7) rotate(38 0 11)">
                    <rect x="-1.7" y="1.5" width="3.4" height="6.5" rx="0.5" fill="currentColor" />
                    <rect x="-1.7" y="0" width="3.4" height="1.7" rx="0.6" fill="currentColor" opacity="0.5" />
                    <path d="M -1.7 8 L 1.7 8 L 0 11 Z" fill="currentColor" />
                </g>
            </g>
        </svg>
    );
}

export default RenameToolIcon;
