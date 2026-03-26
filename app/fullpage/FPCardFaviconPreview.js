import React, { useEffect, useMemo, useRef, useState } from 'react';

const FAVICON_SIZE = 22;
const FAVICON_GAP = 5;

function FPCardFaviconPreview({
    tabs = [],
    alwaysShowAllThreshold = 8,
    maxPreviewCount = 10,
}) {
    const faviconContainerRef = useRef(null);
    const [visibleFaviconCount, setVisibleFaviconCount] = useState(null);

    const faviconEntries = useMemo(() => {
        return tabs.slice(0, maxPreviewCount).map((tab, index) => ({
            key: tab.uid || tab.id || tab.url || `favicon-${index}`,
            src: tab.favIconUrl || './images/favicon-fallback.png',
        }));
    }, [maxPreviewCount, tabs]);

    useEffect(() => {
        const updateVisibleFavicons = () => {
            if (tabs.length <= alwaysShowAllThreshold) {
                setVisibleFaviconCount(faviconEntries.length);
                return;
            }

            const faviconContainer = faviconContainerRef.current;
            const containerWidth = faviconContainer?.clientWidth || 0;

            // In tests or before layout settles, widths may not be measurable yet.
            if (containerWidth <= 0) {
                setVisibleFaviconCount(faviconEntries.length);
                return;
            }

            const computedStyles = faviconContainer ? window.getComputedStyle(faviconContainer) : null;
            const parsedMaxHeight = computedStyles ? Number.parseFloat(computedStyles.maxHeight) : NaN;
            const parsedMinHeight = computedStyles ? Number.parseFloat(computedStyles.minHeight) : NaN;
            const availableHeight = Number.isFinite(parsedMaxHeight) && parsedMaxHeight > 0
                ? parsedMaxHeight
                : (faviconContainer?.clientHeight || parsedMinHeight || FAVICON_SIZE);
            const faviconFootprint = FAVICON_SIZE + FAVICON_GAP;
            const iconsPerRow = Math.max(1, Math.floor((containerWidth + FAVICON_GAP) / faviconFootprint));
            const maxRows = Math.max(1, Math.floor((availableHeight + FAVICON_GAP) / faviconFootprint));
            const maxWithoutCounter = iconsPerRow * maxRows;

            if (faviconEntries.length <= maxWithoutCounter) {
                setVisibleFaviconCount(faviconEntries.length);
                return;
            }

            const maxWithCounter = Math.max(1, maxWithoutCounter - 1);

            setVisibleFaviconCount(Math.max(0, Math.min(faviconEntries.length, maxWithCounter)));
        };

        updateVisibleFavicons();

        if (typeof ResizeObserver === 'function' && faviconContainerRef.current) {
            const resizeObserver = new ResizeObserver(() => {
                updateVisibleFavicons();
            });

            resizeObserver.observe(faviconContainerRef.current);

            return () => resizeObserver.disconnect();
        }

        window.addEventListener('resize', updateVisibleFavicons);
        return () => window.removeEventListener('resize', updateVisibleFavicons);
    }, [alwaysShowAllThreshold, faviconEntries.length, tabs.length]);

    const visibleFavicons = useMemo(() => {
        if (visibleFaviconCount === null) {
            return faviconEntries;
        }

        return faviconEntries.slice(0, visibleFaviconCount);
    }, [faviconEntries, visibleFaviconCount]);

    const hiddenFaviconCount = Math.max(faviconEntries.length - visibleFavicons.length, 0);

    return (
        <div className="fp-card-favicons" ref={faviconContainerRef}>
            <div className="fp-card-favicon-strip">
                {visibleFavicons.map((favicon) => (
                    <img
                        key={favicon.key}
                        src={favicon.src}
                        alt=""
                        className="fp-card-favicon"
                        onError={(event) => {
                            if (event.target.dataset.fallbackApplied === 'true') {
                                return;
                            }

                            event.target.dataset.fallbackApplied = 'true';
                            event.target.src = './images/favicon-fallback.png';
                        }}
                    />
                ))}
                {faviconEntries.length === 0 && (
                    <span className="fp-card-no-favicons">No tabs</span>
                )}
            </div>
            {hiddenFaviconCount > 0 && (
                <span className="fp-card-favicon-more">+{hiddenFaviconCount}</span>
            )}
        </div>
    );
}

export default FPCardFaviconPreview;
