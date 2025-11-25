import React, { useState, useEffect, useRef } from 'react';
import { MdFilterList, MdClear, MdPalette, MdOpenInBrowser } from 'react-icons/md';
import ColorPicker from './ColorPicker';
import './CollectionFilter.css';



function RecentlyOpenedFilter({ isActive, onToggle }) {
    return (
        <button
            className={`filter-button opened-filter ${isActive ? 'active' : ''}`}
            onClick={onToggle}
            data-tooltip-id="main-tooltip" data-tooltip-content="Show collections opened in the last 3 hours"
            data-tooltip-class-name="small-tooltip"
        >
            <MdOpenInBrowser size={14} /><span className="filter-label">Opened</span>
        </button>
    );
}

function ColorFilter({ selectedColor, onColorChange, onClear }) {
    const handleColorSelect = (colorName) => {
        if (selectedColor === colorName) {
            onClear(); // Toggle off if same color clicked
        } else {
            onColorChange(colorName);
        }
    };

    return (
        <div className="color-filter-wrapper">
            <MdPalette size={16} className="color-filter-icon" />
            <ColorPicker
                currentColor={selectedColor}
                action={handleColorSelect}
                tooltip="Filter by collection color"
                size="small"
            />
        </div>
    );
}

function ClearFiltersButton({ hasActiveFilters, onClear }) {
    if (!hasActiveFilters) return null;

    return (
        <button
            className="clear-filters-button"
            onClick={onClear}
            data-tooltip-id="main-tooltip" data-tooltip-content="Clear all filters"
            data-tooltip-class-name="small-tooltip"
        >
            <MdClear size={14} />
        </button>
    );
}

export function CollectionFilter({ onFiltersChange }) {
    const [recentlyOpenedActive, setRecentlyOpenedActive] = useState(false);
    const [selectedColor, setSelectedColor] = useState(null);
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
                color: selectedColor
            });
        }
    }, [recentlyOpenedActive, selectedColor]);

    const handleRecentlyOpenedToggle = () => {
        if (isMountedRef.current) {
            setRecentlyOpenedActive(!recentlyOpenedActive);
        }
    };

    const handleColorChange = (colorName) => {
        if (isMountedRef.current) {
            setSelectedColor(colorName);
        }
    };

    const handleColorClear = () => {
        if (isMountedRef.current) {
            setSelectedColor(null);
        }
    };

    const handleClearAll = () => {
        if (isMountedRef.current) {
            setRecentlyOpenedActive(false);
            setSelectedColor(null);
        }
    };

    const hasActiveFilters = recentlyOpenedActive || selectedColor;

    return (
        <div className="collection-filter">
            <div className="filter-icon">
                <MdFilterList size={16} />
            </div>
            
            <div className="filter-controls">
                <RecentlyOpenedFilter
                    isActive={recentlyOpenedActive}
                    onToggle={handleRecentlyOpenedToggle}
                />
                
                <ColorFilter
                    selectedColor={selectedColor}
                    onColorChange={handleColorChange}
                    onClear={handleColorClear}
                />
            </div>

            <ClearFiltersButton
                hasActiveFilters={hasActiveFilters}
                onClear={handleClearAll}
            />
        </div>
    );
} 