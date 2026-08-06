import React from 'react';
import './ProBadge.css';

function ProBadge({ className = '' }) {
    return (
        <span
            className={`pro-badge${className ? ` ${className}` : ''}`}
            aria-label="Tabox Pro feature"
        >
            Pro
        </span>
    );
}

export default ProBadge;
