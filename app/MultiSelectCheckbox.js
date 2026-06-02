import React from 'react';
import './MultiSelectCheckbox.css';

function MultiSelectCheckbox({
    checked = false,
    className = '',
    ariaLabel,
    accentColor,
    style,
    tabIndex = 0,
    title,
    onClick,
    ...rest
}) {
    return (
        <button
            type="button"
            className={[
                'multi-select-checkbox',
                checked ? 'is-checked' : '',
                className,
            ].filter(Boolean).join(' ')}
            style={{
                ...(accentColor ? { '--multi-select-checkbox-accent': accentColor } : {}),
                ...style,
            }}
            aria-label={ariaLabel}
            aria-pressed={checked}
            tabIndex={tabIndex}
            title={title}
            onClick={onClick}
            {...rest}
        >
            <span className="multi-select-checkbox-frame" aria-hidden="true">
                <span className="multi-select-checkbox-checkmark" />
            </span>
        </button>
    );
}

export default MultiSelectCheckbox;
