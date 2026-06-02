import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { MdClear, MdPalette, MdOpenInBrowser } from 'react-icons/md';
import ColorPicker from './ColorPicker';
import './CollectionFilter.css';

function FilterTooltip({ content, place = 'top', children, disabled = false }) {
    const anchorRef = useRef(null);
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState(null);
    const tooltipRef = useRef(null);

    const updatePosition = () => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const viewportPadding = 8;
        const estimatedWidth = tooltipRef.current?.offsetWidth ?? 220;
        const halfWidth = estimatedWidth / 2;
        const minLeft = viewportPadding + halfWidth;
        const maxLeft = window.innerWidth - viewportPadding - halfWidth;
        const centeredLeft = rect.left + rect.width / 2;
        const clampedLeft = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
        const arrowOffset = centeredLeft - clampedLeft;

        setPosition({
            left: clampedLeft,
            top: place === 'top' ? rect.top - 8 : rect.bottom + 8,
            arrowOffset,
        });
    };

    const showTooltip = () => {
        updatePosition();
        setIsVisible(true);
    };

    const hideTooltip = () => {
        setIsVisible(false);
    };

    useEffect(() => {
        if (disabled) {
            setIsVisible(false);
        }
    }, [disabled]);

    useEffect(() => {
        if (!isVisible) return undefined;
        updatePosition();
        const handleWindowChange = () => updatePosition();
        window.addEventListener('scroll', handleWindowChange, true);
        window.addEventListener('resize', handleWindowChange);
        return () => {
            window.removeEventListener('scroll', handleWindowChange, true);
            window.removeEventListener('resize', handleWindowChange);
        };
    }, [isVisible, place]);

    return (
        <span
            ref={anchorRef}
            className={`filter-tooltip-anchor filter-tooltip-${place}`}
            onMouseEnter={disabled ? undefined : showTooltip}
            onMouseLeave={hideTooltip}
            onFocus={disabled ? undefined : showTooltip}
            onBlur={hideTooltip}
        >
            {children}
            {!disabled && isVisible && position && typeof document !== 'undefined' && ReactDOM.createPortal(
                <span
                    ref={tooltipRef}
                    className={`filter-inline-tooltip filter-inline-tooltip-${place}`}
                    role="tooltip"
                    style={{
                        left: `${position.left}px`,
                        top: `${position.top}px`,
                        '--filter-tooltip-arrow-offset': `${position.arrowOffset}px`,
                    }}
                >
                    {content}
                </span>,
                document.body
            )}
        </span>
    );
}

function RecentlyOpenedFilter({ isActive, onToggle }) {
    return (
        <FilterTooltip content="Show collections opened in the last 3 hours" place="top">
            <button
                id="filter-recently-opened"
                type="button"
                className={`fp-toolbar-pill ${isActive ? 'active' : ''}`}
                onClick={onToggle}
            >
                <MdOpenInBrowser size={18} />
                <span className="collection-filter-opened-label">Opened</span>
            </button>
        </FilterTooltip>
    );
}

function ColorFilter({ selectedColors, onToggleColor, onClear }) {
    const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

    return (
        <div className="fp-toolbar-color-picker" id="filter-color-picker">
            <MdPalette size={18} className="fp-toolbar-color-icon" />
            <FilterTooltip
                content="Filter collections by color"
                place="bottom"
                disabled={isColorPickerOpen}
            >
                <ColorPicker
                    multiSelect
                    selectedColors={selectedColors}
                    action={onToggleColor}
                    onClear={onClear}
                    size="small"
                    showTriggerTooltip={false}
                    showOptionTooltips={false}
                    onOpenChange={setIsColorPickerOpen}
                />
            </FilterTooltip>
        </div>
    );
}

function ClearFiltersButton({ hasActiveFilters, onClear }) {
    if (!hasActiveFilters) return null;

    return (
        <FilterTooltip content="Clear all filters" place="bottom">
            <button
                id="filter-clear"
                type="button"
                className="fp-toolbar-clear"
                onClick={onClear}
            >
                <MdClear size={16} />
            </button>
        </FilterTooltip>
    );
}

export function CollectionFilter({ onFiltersChange }) {
    const [recentlyOpenedActive, setRecentlyOpenedActive] = useState(false);
    const [selectedColors, setSelectedColors] = useState([]);
    const isMountedRef = useRef(true);
    const isInitialRenderRef = useRef(true);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Notify parent component when filters change (but not on initial render)
    useEffect(() => {
        if (isInitialRenderRef.current) {
            isInitialRenderRef.current = false;
            return; // Skip the first render
        }
        
        if (isMountedRef.current && onFiltersChange) {
            onFiltersChange({
                recentlyOpenedActual: recentlyOpenedActive,
                colors: selectedColors,
            });
        }
    }, [recentlyOpenedActive, selectedColors]);

    const handleRecentlyOpenedToggle = () => {
        if (isMountedRef.current) {
            setRecentlyOpenedActive(!recentlyOpenedActive);
        }
    };

    const handleToggleColor = (colorName) => {
        if (!isMountedRef.current) return;
        setSelectedColors((prev) =>
            prev.includes(colorName) ? prev.filter((c) => c !== colorName) : [...prev, colorName]
        );
    };

    const handleColorClear = () => {
        if (isMountedRef.current) setSelectedColors([]);
    };

    const handleClearAll = () => {
        if (isMountedRef.current) {
            setRecentlyOpenedActive(false);
            setSelectedColors([]);
        }
    };

    const hasActiveFilters = recentlyOpenedActive || selectedColors.length > 0;

    return (
        <>
            <div className={`fp-toolbar-leading collection-filter-leading ${hasActiveFilters ? 'is-visible' : ''}`}>
                <ClearFiltersButton
                    hasActiveFilters={hasActiveFilters}
                    onClear={handleClearAll}
                />
                <div className="fp-toolbar-divider fp-toolbar-leading-divider" />
            </div>

            <div className="fp-toolbar-group collection-filter-group">
                <RecentlyOpenedFilter
                    isActive={recentlyOpenedActive}
                    onToggle={handleRecentlyOpenedToggle}
                />
                
                <ColorFilter
                    selectedColors={selectedColors}
                    onToggleColor={handleToggleColor}
                    onClear={handleColorClear}
                />
            </div>
        </>
    );
} 
