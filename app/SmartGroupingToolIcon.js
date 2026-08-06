import React from 'react';
import './SmartGroupingToolIcon.css';

// Animated icon for the primary "Smart Tab Grouping" hero card.
// Static state: four gradient-filled tabs scattered loosely. On hero hover
// they snap into a tidy 2×2 group — conveying "group loose tabs". Reversible
// transition (no loop). Under prefers-reduced-motion / performance mode the
// tabs rest grouped (static). Decorative only.
function SmartGroupingToolIcon({ className = '' }) {
    return (
        <svg
            className={`sg-svg ${className}`.trim()}
            width="40"
            height="40"
            viewBox="0 0 30 30"
            fill="none"
            aria-hidden="true"
        >
            <defs>
                <linearGradient id="sgGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#2ad6f5" />
                    <stop offset="0.5" stopColor="#4361ee" />
                    <stop offset="1" stopColor="#a435f5" />
                </linearGradient>
            </defs>
            <rect className="sg-tab sg-1" x="3" y="3" width="11" height="11" rx="2.5" fill="url(#sgGrad)" />
            <rect className="sg-tab sg-2" x="16" y="3" width="11" height="11" rx="2.5" fill="url(#sgGrad)" />
            <rect className="sg-tab sg-3" x="3" y="16" width="11" height="11" rx="2.5" fill="url(#sgGrad)" />
            <rect className="sg-tab sg-4" x="16" y="16" width="11" height="11" rx="2.5" fill="url(#sgGrad)" />
        </svg>
    );
}

export default SmartGroupingToolIcon;
