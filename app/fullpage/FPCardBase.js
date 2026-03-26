import React from 'react';
import FPCardFaviconPreview from './FPCardFaviconPreview';
import FPCardMatchingTabs from './FPCardMatchingTabs';
import './FPCollectionCard.css';

function FPCardBase({
    className = '',
    style,
    onClick,
    onContextMenu,
    onKeyDown,
    ariaLabel,
    title,
    titleText,
    titleLeading = null,
    titleBadges = null,
    topBadge = null,
    meta = null,
    timeLabel = null,
    tabs = [],
    matchingTabs = [],
    search = '',
    onOpenMatchingTab,
    matchingTabsResetKey,
    matchingTabsTabIndex,
    matchClassName = 'fp-card-search-match',
    actionMenu = null,
    actions = null,
    dragAttributes,
    dragListeners,
}) {
    const hasSearchMatches = !!search?.trim() && matchingTabs.length > 0;

    return (
        <div
            className={[
                'fp-card',
                topBadge ? 'fp-card-has-top-badge' : '',
                hasSearchMatches ? 'fp-card-has-matches' : '',
                className,
            ].filter(Boolean).join(' ')}
            style={style}
            onClick={onClick}
            onContextMenu={onContextMenu}
            {...dragAttributes}
            {...dragListeners}
            role="button"
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label={ariaLabel}
        >
            {topBadge && (
                <div className="fp-card-top-badge-wrap">
                    {topBadge}
                </div>
            )}

            <div className="fp-card-body">
                <div className="fp-card-title-row">
                    {titleLeading}
                    <h3 className="fp-card-title" title={titleText || (typeof title === 'string' ? title : undefined)}>
                        {title}
                    </h3>
                    {titleBadges}
                </div>

                <div className="fp-card-footer">
                    {!hasSearchMatches && (
                        <FPCardFaviconPreview tabs={tabs} />
                    )}

                    <div className="fp-card-stats">
                        {meta && (
                            <div className="fp-card-meta">
                                {meta}
                            </div>
                        )}
                        {timeLabel !== null && timeLabel !== undefined && (
                            <div className="fp-card-time">
                                {timeLabel}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <FPCardMatchingTabs
                matchingTabs={matchingTabs}
                search={search}
                onOpenTab={onOpenMatchingTab}
                resetKey={matchingTabsResetKey}
                matchClassName={matchClassName}
                tabIndex={matchingTabsTabIndex}
            />

            {actionMenu && (
                <div
                    className="fp-card-action-menu"
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {actionMenu}
                </div>
            )}

            {actions && (
                <div
                    className="fp-card-actions"
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {actions}
                </div>
            )}
        </div>
    );
}

export default FPCardBase;
