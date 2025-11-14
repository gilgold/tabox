import React, { useState, useEffect, useRef } from 'react';
import { MdExpandMore, MdExpandLess } from 'react-icons/md';
import { browser } from '../static/globals';
import './CollapsableSection.css';

function CollapsableSection({
    sectionKey,
    sectionTitle,
    count,
    children,
    expandTooltip = "Expand section",
    collapseTooltip = "Collapse section",
    className = ""
}) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const isMountedRef = useRef(true);

    // Load collapsed state from localStorage on mount
    useEffect(() => {
        const loadCollapsedState = async () => {
            try {
                const result = await browser.storage.local.get([sectionKey]);
                // Only update state if component is still mounted
                if (isMountedRef.current) {
                    setIsCollapsed(result[sectionKey] || false);
                }
            } catch (error) {
                console.error(`Error loading collapsed state for ${sectionKey}:`, error);
            }
        };
        loadCollapsedState();

        // Cleanup function to mark component as unmounted
        return () => {
            isMountedRef.current = false;
        };
    }, [sectionKey]);

    // Save collapsed state to localStorage when changed
    const toggleCollapsed = async () => {
        const newState = !isCollapsed;
        // Only update state if component is still mounted
        if (isMountedRef.current) {
            setIsCollapsed(newState);
        }
        try {
            await browser.storage.local.set({ [sectionKey]: newState });
        } catch (error) {
            console.error(`Error saving collapsed state for ${sectionKey}:`, error);
        }
    };

    return (
        <>
            {/* Render header - always visible */}
            <div 
                className={`section-header collapsible-header ${className}`}
                onClick={toggleCollapsed}
                data-tip={isCollapsed ? expandTooltip : collapseTooltip}
            >
                <div className="section-header-content">
                    {isCollapsed ? <MdExpandMore size={18} /> : <MdExpandLess size={18} />}
                    <span className="section-title">{sectionTitle}</span>
                    <span className="section-count">({count})</span>
                </div>
            </div>
            
            {/* Render children only when not collapsed */}
            {!isCollapsed && children}
        </>
    );
}

export default CollapsableSection;