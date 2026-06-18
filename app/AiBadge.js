import React from 'react';
import './AiBadge.css';

// Small "AI" pill with the purple/blue Tabox AI gradient. Used to mark an
// action as AI-powered (e.g. the "Split Collection" context-menu item) instead
// of a text "[AI]" prefix.
function AiBadge({ className = '' }) {
    return (
        <span className={`ai-badge${className ? ` ${className}` : ''}`} aria-label="AI">AI</span>
    );
}

export default AiBadge;
