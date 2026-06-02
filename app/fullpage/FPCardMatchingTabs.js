import React, { useEffect, useMemo, useState } from 'react';
import { highlightText } from '../utils/searchUtils';

function FPCardMatchingTabs({
    matchingTabs = [],
    search = '',
    onOpenTab,
    resetKey,
    matchClassName = 'fp-card-search-match',
    tabIndex,
}) {
    const [showAllMatchingTabs, setShowAllMatchingTabs] = useState(false);

    useEffect(() => {
        setShowAllMatchingTabs(false);
    }, [matchingTabs.length, resetKey, search]);

    const visibleMatchingTabs = useMemo(() => (
        showAllMatchingTabs ? matchingTabs : matchingTabs.slice(0, 5)
    ), [matchingTabs, showAllMatchingTabs]);

    if (!search?.trim() || matchingTabs.length === 0) {
        return null;
    }

    return (
        <div
            className="fp-card-matching-tabs"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {visibleMatchingTabs.map((tab, index) => (
                <a
                    key={tab.uid || tab.id || index}
                    className="fp-card-matching-tab"
                    href={tab.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tab.url}
                    tabIndex={tabIndex}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenTab?.(tab);
                    }}
                >
                    {tab.favIconUrl && (
                        <img
                            src={tab.favIconUrl}
                            alt=""
                            className="fp-card-matching-tab-favicon"
                            onError={(event) => { event.target.style.display = 'none'; }}
                        />
                    )}
                    <div className="fp-card-matching-tab-info">
                        <span className="fp-card-matching-tab-title">
                            {highlightText(tab.title, search, matchClassName) || tab.title}
                        </span>
                        <span className="fp-card-matching-tab-url">
                            {highlightText(tab.url, search, matchClassName) || tab.url}
                        </span>
                    </div>
                </a>
            ))}
            {matchingTabs.length > 5 && (
                <button
                    type="button"
                    className="fp-card-matching-tabs-more"
                    tabIndex={tabIndex}
                    onClick={(event) => {
                        event.stopPropagation();
                        setShowAllMatchingTabs(!showAllMatchingTabs);
                    }}
                >
                    {showAllMatchingTabs
                        ? 'Show less'
                        : `+ ${matchingTabs.length - 5} more tab${matchingTabs.length - 5 !== 1 ? 's' : ''}...`}
                </button>
            )}
        </div>
    );
}

export default FPCardMatchingTabs;
