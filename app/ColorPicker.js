import React, { useEffect, useState } from 'react';
import { Popover } from 'react-tiny-popover';
import { COLOR_PALETTE } from './utils/colorMigration';

function ColorPicker(props) {

    const [color, setColor] = useState(props?.currentColor ?? 'var(--setting-row-border-color)');
    const [showPicker, setShowPicker] = useState(false);
    const [selectedColorCircle, setSelectedColorCircle] = useState(0);

    const colorList = props.colorList ?? COLOR_PALETTE;

    // Helper function to get actual color value (supports both new names and legacy hex codes)
    const getActualColor = (color) => {
        if (!color) return 'var(--setting-row-border-color)';
        
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
        setColor(colorValue); // Set display color to hex value
        setSelectedColorCircle(index);
        props.action(colorName, props.group ?? null); // Pass color name for storage
        setShowPicker(false); // Close picker after selection
    };

    const handleClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        setShowPicker(!showPicker);
    };

    const handleClose = (e) => {
        if (e && ['colorOption', 'modern-color-option', 'color-grid'].includes(e.target.className)) return;
        setShowPicker(false);
    };

    const size = props.size === 'small' ? 'small' : 'normal';

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
                <div className="color-grid">
                    {Object.entries(colorList).map(([colorName, colorValue], index) => (
                        <div
                            key={`color-${colorName}`}
                            onClick={async (e) => await handleChange(colorName, colorValue, index, e)}
                            className={`modern-color-option ${index === selectedColorCircle ? 'selected' : ''}`}
                            style={{ 
                                backgroundColor: colorValue,
                                '--color-value': colorValue 
                            }}
                            data-tooltip-id="main-tooltip" data-tooltip-content={colorName.replace('-', ' ')}
                            data-for="color-tooltip">
                            {index === selectedColorCircle && (
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
        <div onClick={handleClick} className={`modern-color-picker-wrapper ${size}`} data-tooltip-hidden={showPicker} data-tooltip-id="main-tooltip" data-tooltip-content={props.tooltip}>
            <div className={`modern-color-picker ${showPicker ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleClick(e); }}>
                <div className="current-color-preview" style={{ backgroundColor: color }} />
            </div>
        </div>
    </Popover>;
}

export default ColorPicker;
