import React, { useState } from 'react';
import { MdExpandMore, MdExpandLess, MdFolder, MdDragIndicator } from 'react-icons/md';
import { AutoSaveTextbox } from './AutoSaveTextbox';
import ColorPicker from './ColorPicker';
import DeleteWithConfirmationButton from './DeleteWithConfirmationButton';
import DroppableGroupHeader from './DroppableGroupHeader';
import { getColorCode, tabGrooupColorChart } from './utils';
import { getColorValue } from './utils/colorMigration';

function GroupContainer({ 
    group, 
    tabs, 
    children, 
    onSaveGroupColor, 
    onSaveGroupName, 
    onDeleteGroup,
    isExpanded = true,
    onToggleExpanded 
}) {
    const [localExpanded, setLocalExpanded] = useState(isExpanded);
    
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
        fontSize: '18px',
        flexShrink: 0,
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

    const groupStatsStyle = {
        fontSize: '11px',
        color: 'var(--secondary-text-color)',
        fontWeight: '500',
        opacity: 0.8,
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

    const tabsContainerStyle = {
        padding: localExpanded ? '8px 0' : '0',
        maxHeight: localExpanded ? 'none' : '0',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        background: 'var(--section-bg-color)',
    };

    return (
        <div style={containerStyle} className="group-container">
            <DroppableGroupHeader group={group}>
                <div style={headerStyle} onClick={(e) => {
                    // Only toggle if not clicking on interactive elements
                    if (!e.target.closest('.autosave-wrapper') && 
                        !e.target.closest('.auto-save-textbox') && 
                        !e.target.closest('.color-picker') && 
                        !e.target.closest('.colorPickerWrapper') &&
                        !e.target.closest('.group-actions')) {
                        e.stopPropagation(); // Prevent collection from closing
                        toggleExpanded();
                    }
                }}>
                    <div style={titleSectionStyle}>
                        <MdFolder style={iconStyle} />
                        <div style={groupInfoStyle}>
                            <div style={groupTitleStyle}>
                                <AutoSaveTextbox
                                    initValue={group.title}
                                    item={group}
                                    action={onSaveGroupName}
                                    className="group-title-input"
                                />
                                <span style={groupStatsStyle}>
                                    {tabCount} tab{tabCount !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <div style={actionsStyle} className="group-actions" onClick={(e) => e.stopPropagation()}>
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
            
            <div style={tabsContainerStyle} className="group-tabs-container">
                {localExpanded && children}
            </div>
        </div>
    );
}

export default GroupContainer; 