import React from 'react';
import './FPBadge.css';

const semanticAccents = new Set([
    'neutral',
    'tabs',
    'groups',
    'folder',
    'match',
    'success',
    'warning',
    'info',
    'current-window',
    'session',
]);

function isRawAccent(accent) {
    return typeof accent === 'string' && (
        accent.startsWith('#') ||
        accent.startsWith('rgb') ||
        accent.startsWith('hsl') ||
        accent.startsWith('var(') ||
        accent.startsWith('color-mix(')
    );
}

function FPBadge({
    as: Component = 'span',
    accent = 'neutral',
    className = '',
    children,
    leading = null,
    style,
    ...props
}) {
    const accentClass = semanticAccents.has(accent) ? `fp-badge-accent-${accent}` : 'fp-badge-accent-neutral';
    const accentStyle = isRawAccent(accent)
        ? { '--fp-badge-accent': accent }
        : null;

    return (
        <Component
            className={['fp-badge', accentClass, className].filter(Boolean).join(' ')}
            style={{
                ...accentStyle,
                ...style,
            }}
            {...props}
        >
            {leading}
            {children}
        </Component>
    );
}

export default FPBadge;
