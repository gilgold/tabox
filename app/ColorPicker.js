import React, { useEffect, useState } from 'react';
import { Popover } from 'react-tiny-popover';
import { COLOR_PALETTE, getColorValue } from './utils/colorMigration';

function ColorPicker(props) {

    const multiSelect = props.multiSelect === true;
    const selectedColors = props.selectedColors ?? [];

    const [color, setColor] = useState(props?.currentColor ?? 'var(--collection-default-color)');
    const [showPicker, setShowPicker] = useState(false);
    const [selectedColorCircle, setSelectedColorCircle] = useState(0);

    const colorList = props.colorList ?? COLOR_PALETTE;
    const showTriggerTooltip = props.showTriggerTooltip !== false;
    const showOptionTooltips = props.showOptionTooltips !== false;

    // Helper function to get actual color value (supports both new names and legacy hex codes)
    const getActualColor = (color) => {
        if (!color) return 'var(--collection-default-color)';
        
        // If it's a color name from our palette, get its hex value
        if (COLOR_PALETTE[color]) {
            return COLOR_PALETTE[color];
        }
        
        // If it's already a hex code or CSS variable, return as is
        return color;
    };

    useEffect(() => {
        const actualColor = getActualColor(props?.currentColor);
        setColor(actualColor);
        
        if (props.currentColor) {
            // Find index by checking both color names and values
            const colorEntries = Object.entries(colorList);
            const colorIndex = colorEntries.findIndex(([name, value]) => 
                name === props.currentColor || value === props.currentColor
            );
            setSelectedColorCircle(colorIndex);
        } else {
            // Reset selection when no color is selected
            setSelectedColorCircle(-1);
        }
    }, [props.currentColor]);

    useEffect(() => {
        return () => {
            // Safely close picker only if component is still mounted
            try {
                setShowPicker(false);
            } catch (error) {
                // Component was unmounted, ignore error
                console.debug('ColorPicker cleanup: component already unmounted');
            }
        };
    }, []);

    const handleChange = async (colorName, colorValue, index, e) => {
        e.stopPropagation();
        props.action(colorName, props.group ?? null); // Pass color name for storage
        if (!multiSelect) {
            setColor(colorValue); // Set display color to hex value
            setSelectedColorCircle(index);
            setShowPicker(false); // Close picker after selection
            props.onOpenChange?.(false);
        }
    };

    const handleClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const nextShowPicker = !showPicker;
        setShowPicker(nextShowPicker);
        props.onOpenChange?.(nextShowPicker);
    };

    const handleClose = (e) => {
        if (e && ['colorOption', 'modern-color-option', 'color-grid'].includes(e.target.className)) return;
        setShowPicker(false);
        props.onOpenChange?.(false);
    };

    const size = props.size === 'small' ? 'small' : 'normal';

    const triggerBackground = (() => {
        if (!multiSelect) return color;
        if (selectedColors.length === 0) return 'var(--collection-default-color)';
        if (selectedColors.length === 1) return getColorValue(selectedColors[0]);
        const stops = selectedColors.map((name, i) => {
            const pct = Math.round((i / (selectedColors.length - 1)) * 100);
            return `${getColorValue(name)} ${pct}%`;
        });
        return `linear-gradient(135deg, ${stops.join(', ')})`;
    })();

    return <Popover
        isOpen={showPicker}
        positions={['bottom', 'top', 'right', 'left']} // try bottom first for modern feel
        onClickOutside={handleClose}
        containerStyle={{ zIndex: 2000 }}
        contentStyle={{ zIndex: 2000 }}
        content={
            <div className={`modern-color-popover ${size}`} style={{ zIndex: 2000 }}>
                <div className="color-picker-header">
                    <span>Choose Color</span>
                </div>
                {multiSelect && (
                    <button
                        type="button"
                        className="color-picker-clear-row"
                        disabled={selectedColors.length === 0}
                        onClick={(e) => { e.stopPropagation(); props.onClear?.(); }}
                    >
                        Clear Selection
                    </button>
                )}
                <div className="color-grid">
                    {Object.entries(colorList).map(([colorName, colorValue], index) => (
                        <div
                            key={`color-${colorName}`}
                            onClick={async (e) => await handleChange(colorName, colorValue, index, e)}
                            className={`modern-color-option ${
                                multiSelect
                                    ? (selectedColors.includes(colorName) ? 'selected' : '')
                                    : (index === selectedColorCircle ? 'selected' : '')
                            }`}
                            style={{ 
                                backgroundColor: colorValue,
                                '--color-value': colorValue 
                            }}
                            data-tooltip-id={showOptionTooltips ? 'main-tooltip' : undefined}
                            data-tooltip-content={showOptionTooltips ? colorName.replace('-', ' ') : undefined}
                            data-for={showOptionTooltips ? 'color-tooltip' : undefined}>
                            {(multiSelect ? selectedColors.includes(colorName) : index === selectedColorCircle) && (
                                <div className="selection-indicator">
                                    <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                                        <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>}
    >
        <div
            onClick={handleClick}
            className={`modern-color-picker-wrapper ${size}`}
            data-tooltip-hidden={showTriggerTooltip ? showPicker : undefined}
            data-tooltip-id={showTriggerTooltip ? 'main-tooltip' : undefined}
            data-tooltip-content={showTriggerTooltip ? props.tooltip : undefined}
            data-tooltip-place={showTriggerTooltip ? props.tooltipPlace : undefined}
        >
            <div className={`modern-color-picker ${showPicker ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleClick(e); }}>
                <div
                    className="current-color-preview"
                    // `background` paints the preview (solid or gradient). The duplicate
                    // `--current-color-bg` custom property is only so jsdom-based tests can read
                    // the gradient value, which jsdom drops from the `background` shorthand.
                    style={multiSelect
                        ? { '--current-color-bg': triggerBackground, background: triggerBackground }
                        : { backgroundColor: color }}
                />
            </div>
        </div>
    </Popover>;
}

export default ColorPicker;
