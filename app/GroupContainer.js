import React, { useState, useEffect } from 'react';
import { MdExpandMore, MdExpandLess, MdDragIndicator, MdOpenInNew } from 'react-icons/md';
import { PiTabs } from 'react-icons/pi';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import ColorPicker from './ColorPicker';
import DeleteWithConfirmationButton from './DeleteWithConfirmationButton';
import DroppableGroupHeader from './DroppableGroupHeader';
import { getColorCode, tabGrooupColorChart } from './utils';
import { getColorValue } from './utils/colorMigration';

// Compact label for the tab-count badge so large numbers fit a small circle:
// 0–999 shown as-is, 1,000–99,999 collapse to "1k"…"99k", anything bigger caps at "99k+".
function formatCompactCount(count) {
    const n = Number(count) || 0;
    if (n < 1000) return String(n);
    if (n < 100000) return `${Math.floor(n / 1000)}k`;
    return '99k+';
}

// Pick black or white text so the count stays legible on any group color,
// including bright/light ones where white would wash out. Uses perceived
// (sRGB-weighted) luminance.
function getReadableTextColor(hex) {
    if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) {
        return '#fff';
    }
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if ([r, g, b].some(Number.isNaN)) {
        return '#fff';
    }
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#1a1a1a' : '#fff';
}

function GroupContainer({
    group, 
    tabs, 
    children, 
    onSaveGroupColor, 
    onSaveGroupName, 
    onDeleteGroup,
    onOpenGroupTabs,
    isExpanded = true,
    onToggleExpanded,
    isDragging = false,
    headerDropProps = null,
    bodyDropProps = null,
    dragAttributes = {},
    dragListeners = {}
}) {
    // When dragging, always show collapsed
    const [localExpanded, setLocalExpanded] = useState(isDragging ? false : isExpanded);
    
    // Update expanded state when dragging changes
    useEffect(() => {
        if (isDragging) {
            setLocalExpanded(false);
        } else {
            setLocalExpanded(isExpanded);
        }
    }, [isDragging, isExpanded]);
    
    const toggleExpanded = () => {
        const newExpanded = !localExpanded;
        setLocalExpanded(newExpanded);
        if (onToggleExpanded) {
            onToggleExpanded(group.uid, newExpanded);
        }
    };

    // Get group color with proper fallback using the robust color migration utilities
    const getGroupColor = () => {
        if (!group?.color) {
            return '#3b82f6'; // Default blue
        }
        
        try {
            // First, check if it's a color from our tab group color chart
            if (tabGrooupColorChart[group.color]) {
                const tabGroupColor = tabGrooupColorChart[group.color];
                return tabGroupColor;
            }
            
            // Try the legacy getColorCode (which uses tabGrooupColorChart internally)
            const legacyColor = getColorCode(group.color);
            if (legacyColor && typeof legacyColor === 'string' && legacyColor.startsWith('#') && legacyColor.length === 7) {
                return legacyColor;
            }
            
            // Use getColorValue as fallback for any other color systems
            const colorValue = getColorValue(group.color);
            
            // If getColorValue returns a CSS variable, convert to hex
            if (colorValue === 'var(--setting-row-border-color)') {
                return '#6b7280'; // Gray fallback for default
            }
            
            // If it's already a hex code, validate and use it
            if (typeof colorValue === 'string' && colorValue.startsWith('#') && colorValue.length === 7) {
                return colorValue;
            }
            
            // Ultimate fallback
            return '#3b82f6';
            
        } catch (error) {
            console.warn('Error getting group color for', group.color, error);
            return '#3b82f6'; // Default blue fallback
        }
    };
    
    const groupColor = getGroupColor();
    const tabCount = tabs ? tabs.length : 0;
    
    // Calculate alpha from hex color for backgrounds with error handling
    const hexToRgba = (hex, alpha) => {
        // Validate input
        if (!hex || typeof hex !== 'string') {
            return `rgba(59, 130, 246, ${alpha})`; // Default blue
        }
        
        // Ensure it's a hex color
        if (!hex.startsWith('#')) {
            return `rgba(59, 130, 246, ${alpha})`; // Default blue
        }
        
        // Ensure hex is the right length
        if (hex.length !== 7) {
            return `rgba(59, 130, 246, ${alpha})`; // Default blue
        }
        
        try {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            
            // Validate parsed values
            if (isNaN(r) || isNaN(g) || isNaN(b)) {
                return `rgba(59, 130, 246, ${alpha})`; // Default blue
            }
            
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } catch (error) {
            console.warn('Error parsing hex color:', hex, error);
            return `rgba(59, 130, 246, ${alpha})`; // Default blue
        }
    };

    const containerStyle = {
        background: `linear-gradient(135deg, ${hexToRgba(groupColor, 0.03)} 0%, ${hexToRgba(groupColor, 0.08)} 100%)`,
        border: `1px solid ${hexToRgba(groupColor, 0.2)}`,
        borderLeft: `4px solid ${groupColor}`,
        borderRadius: '8px',
        margin: '8px 0',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        boxShadow: `0 2px 8px ${hexToRgba(groupColor, 0.1)}`,
        position: 'relative',
    };

    const headerStyle = {
        background: `linear-gradient(90deg, ${hexToRgba(groupColor, 0.08)} 0%, ${hexToRgba(groupColor, 0.04)} 100%)`,
        borderBottom: localExpanded ? `1px solid ${hexToRgba(groupColor, 0.15)}` : 'none',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
    };

    const titleSectionStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flex: 1,
        minWidth: 0, // Allow text truncation
    };

    const iconStyle = {
        color: groupColor,
        fontSize: '22px',
        flexShrink: 0,
    };

    const iconWrapStyle = {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
    };

    // Size, position and border live in CSS (.group-tab-count-badge) so the badge can
    // be smaller in the popup and larger in full-page mode. Only the color-derived
    // bits stay inline because they depend on the group's color.
    const countBadgeStyle = {
        position: 'absolute',
        boxSizing: 'border-box',
        borderRadius: '999px',
        background: groupColor,
        color: getReadableTextColor(groupColor),
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 1px 3px ${hexToRgba(groupColor, 0.4)}`,
        cursor: 'default',
    };

    const groupInfoStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        flex: 1,
        minWidth: 0,
    };

    const groupTitleStyle = {
        fontSize: '14px',
        fontWeight: '600',
        color: 'var(--text-color)',
        margin: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    };

    const actionsStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
    };

    const expandButtonStyle = {
        background: 'none',
        border: 'none',
        color: groupColor,
        cursor: 'pointer',
        padding: '4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '18px',
        transition: 'all 0.2s ease',
        opacity: 0.7,
    };

    const openButtonStyle = {
        border: 'none',
        background: 'linear-gradient(135deg, rgba(22, 152, 226, 0.18) 0%, rgba(22, 152, 226, 0.1) 100%)',
        color: 'var(--primary-color)',
        padding: '8px 12px',
        borderRadius: '999px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: '700',
        letterSpacing: '0.01em',
        lineHeight: 1,
        boxShadow: 'inset 0 0 0 1px rgba(22, 152, 226, 0.18)',
        opacity: tabCount > 0 ? 1 : 0.45,
        cursor: tabCount > 0 ? 'pointer' : 'not-allowed',
        transition: 'all 0.2s ease',
    };

    const tabsContainerStyle = {
        padding: localExpanded ? '8px 0' : '0',
        maxHeight: localExpanded ? 'none' : '0',
        overflow: 'hidden',
        // No transition on expand: dnd-kit needs stable layout immediately for collision detection.
        // A 0.3s expand animation caused stale droppable rects and "first drag fails" when
        // dragging tabs out of a newly expanded group.
        transition: localExpanded ? 'none' : 'all 0.3s ease',
        background: 'var(--section-bg-color)',
        ...(bodyDropProps?.isOver ? {
            background: `linear-gradient(180deg, ${hexToRgba(groupColor, 0.14)} 0%, var(--section-bg-color) 100%)`,
            outline: `2px dashed ${groupColor}`,
            outlineOffset: '-2px',
        } : {}),
    };

    return (
        <div style={containerStyle} className="group-container">
            <DroppableGroupHeader
                group={group}
                dropProps={headerDropProps}
                showDropZone={!!headerDropProps?.isOver}
            >
                <div style={headerStyle} onClick={(e) => {
                    // Only toggle if not clicking on interactive elements or drag handle
                    if (!e.target.closest('.autosave-wrapper') && 
                        !e.target.closest('.auto-save-textbox') && 
                        !e.target.closest('.color-picker') && 
                        !e.target.closest('.colorPickerWrapper') &&
                        !e.target.closest('.group-actions') &&
                        !e.target.closest('.group-drag-handle')) {
                        e.stopPropagation(); // Prevent collection from closing
                        toggleExpanded();
                    }
                }}>
                    <div style={titleSectionStyle}>
                        {/* Drag handle for group */}
                        <div 
                            className="group-drag-handle" 
                            style={{ 
                                cursor: isDragging ? 'grabbing' : 'grab',
                                display: 'flex',
                                alignItems: 'center',
                                padding: '4px',
                                marginRight: '4px'
                            }}
                            {...dragAttributes}
                            {...dragListeners}
                        >
                            <MdDragIndicator size="16px" color="var(--text-color)" />
                        </div>
                        <div style={iconWrapStyle}>
                            <PiTabs style={iconStyle} />
                            {tabCount > 0 && (
                                <span
                                    style={countBadgeStyle}
                                    className="group-tab-count-badge"
                                    data-tooltip-id="main-tooltip"
                                    data-tooltip-content={`${tabCount} tab${tabCount !== 1 ? 's' : ''} in this group`}
                                >
                                    {formatCompactCount(tabCount)}
                                </span>
                            )}
                        </div>
                        <div style={groupInfoStyle}>
                            <div style={groupTitleStyle}>
                                <AutoSaveTextbox
                                    initValue={group.title}
                                    item={group}
                                    action={onSaveGroupName}
                                    inputClassName="group-title-input"
                                    wrapperClassName="group-title-autosave-wrapper"
                                    hideEditIcon
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div style={actionsStyle} className="group-actions" onClick={(e) => e.stopPropagation()}>
                        {onOpenGroupTabs && (
                            <button
                                style={openButtonStyle}
                                onClick={() => tabCount > 0 && onOpenGroupTabs(group)}
                                disabled={tabCount === 0}
                                aria-label={`Open all tabs in ${group.title}`}
                                data-tooltip-id="main-tooltip"
                                data-tooltip-content={`Open all tabs in ${group.title}`}
                            >
                                <MdOpenInNew size={14} />
                            </button>
                        )}
                        <ColorPicker
                            colorList={tabGrooupColorChart}
                            tooltip="Choose a color for this group"
                            group={group}
                            currentColor={group.color}
                            action={onSaveGroupColor}
                            size="small"
                        />
                        <DeleteWithConfirmationButton
                            action={onDeleteGroup}
                            group={group}
                        />
                        <button 
                            style={expandButtonStyle}
                            onClick={toggleExpanded}
                            title={localExpanded ? 'Collapse group' : 'Expand group'}
                            onMouseEnter={(e) => e.target.style.opacity = '1'}
                            onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                        >
                            {localExpanded ? <MdExpandLess /> : <MdExpandMore />}
                        </button>
                    </div>
                </div>
            </DroppableGroupHeader>
            
            <div
                ref={bodyDropProps?.setNodeRef || null}
                style={tabsContainerStyle}
                className="group-tabs-container"
            >
                {localExpanded && children}
            </div>
        </div>
    );
}

export default GroupContainer; 
