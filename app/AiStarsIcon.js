import React, { useId } from 'react';
import './AiStarsIcon.css';

// The Tabox AI mark: the same three sparkle stars as the toolbar AI button,
// filled with the purple/blue gradient (no frame). Used to label an action as
// AI-powered (e.g. the "Split Collection" context-menu item). `size` is the
// SVG box size in px. The gradient id is unique per instance so multiple icons
// on the page don't reference a colliding <defs> id.
function AiStarsIcon({ size = 22, className = '' }) {
    const gradId = useId();
    return (
        <svg
            className={`ai-stars-icon${className ? ` ${className}` : ''}`}
            viewBox="0 0 24 24"
            width={size}
            height={size}
            aria-hidden="true"
        >
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#3a63db" />
                    <stop offset="100%" stopColor="#5b4fd6" />
                </linearGradient>
            </defs>
            <g fill={`url(#${gradId})`}>
                <path d="M8 4 C8 10.72 9.28 12 16 12 C9.28 12 8 13.28 8 20 C8 13.28 6.72 12 0 12 C6.72 12 8 10.72 8 4 Z" />
                <path d="M17 0 C17 5.88 18.12 7 24 7 C18.12 7 17 8.12 17 14 C17 8.12 15.88 7 10 7 C15.88 7 17 5.88 17 0 Z" />
                <path d="M18 12 C18 17.04 18.96 18 24 18 C18.96 18 18 18.96 18 24 C18 18.96 17.04 18 12 18 C17.04 18 18 17.04 18 12 Z" />
            </g>
        </svg>
    );
}

export default AiStarsIcon;
