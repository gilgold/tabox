import React from 'react';

export const FP_CARD_HOVER_MENU_CLASS = 'fp-card-hover-menu';

function FPCardHoverActions({
    items,
    tooltipPlace = 'right',
}) {
    return (
        <>
            {items.map((item) => {
                if (item.render) {
                    return (
                        <div
                            key={item.key}
                            className={['fp-card-menu-item', item.className].filter(Boolean).join(' ')}
                        >
                            {item.render()}
                            <span className="fp-card-menu-label">{item.label}</span>
                        </div>
                    );
                }

                return (
                    <button
                        key={item.key}
                        type="button"
                        className={['fp-card-rail-button', 'fp-card-menu-item', item.className].filter(Boolean).join(' ')}
                        tabIndex={-1}
                        onClick={item.onClick}
                        aria-label={item.ariaLabel || item.tooltip || item.label}
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content={item.tooltip}
                        data-tooltip-place={tooltipPlace}
                    >
                        {item.icon}
                        <span className="fp-card-menu-label">{item.label}</span>
                    </button>
                );
            })}
        </>
    );
}

export default FPCardHoverActions;
