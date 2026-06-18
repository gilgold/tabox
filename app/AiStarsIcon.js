import React from 'react';
import './AiStarsIcon.css';

// The Tabox AI mark: the same three sparkle stars as the toolbar AI button,
// set in a round purple/blue gradient frame. Used wherever we want to label an
// action as AI-powered (e.g. the "Split Collection" context-menu item) instead
// of a text "[AI]" prefix. `size` is the outer diameter in px.
function AiStarsIcon({ size = 18, className = '' }) {
    return (
        <span
            className={`ai-stars-icon${className ? ` ${className}` : ''}`}
            style={{ width: size, height: size }}
            aria-hidden="true"
        >
            <svg viewBox="0 0 24 24" fill="#fff" width={Math.round(size * 0.72)} height={Math.round(size * 0.72)}>
                <path d="M8 4 C8 10.72 9.28 12 16 12 C9.28 12 8 13.28 8 20 C8 13.28 6.72 12 0 12 C6.72 12 8 10.72 8 4 Z" />
                <path d="M17 0 C17 5.88 18.12 7 24 7 C18.12 7 17 8.12 17 14 C17 8.12 15.88 7 10 7 C15.88 7 17 5.88 17 0 Z" />
                <path d="M18 12 C18 17.04 18.96 18 24 18 C18.96 18 18 18.96 18 24 C18 18.96 17.04 18 12 18 C17.04 18 18 17.04 18 12 Z" />
            </svg>
        </span>
    );
}

export default AiStarsIcon;
