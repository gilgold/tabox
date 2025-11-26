/**
 * Unified Color Utilities for Tabox
 * Consolidates all color-related functions from multiple files
 */

import { COLOR_PALETTE } from './colorMigration';

// Tab group color chart (originally from app/utils.js)
export const tabGroupColorChart = {
    'grey': '#54585d',
    'blue': '#1b68de',
    'red': '#d22c28',
    'yellow': '#fcd065',
    'green': '#21823d',
    'pink': '#fd80c2',
    'purple': '#872fdb',
    'orange': '#fcad6f',
    'cyan': '#6fd3e7'
};

/**
 * Get hex color code from color name
 * @param {string} name - Color name (e.g., 'blue', 'red')
 * @returns {string} Hex color code or original name if not found
 */
export const getColorCode = (name) => {
    if (!name) return name;
    const _name = name.toLowerCase();
    return (_name in tabGroupColorChart) ? tabGroupColorChart[_name] : name;
};

/**
 * Get actual color value (supports both new names and legacy hex codes)
 * @param {string} color - Color name or hex code
 * @returns {string} Actual color value
 */
const getColorValue = (color) => {
    if (!color) return 'var(--setting-row-border-color)';
    
    // If it's a color name from our palette, get its hex value
    if (COLOR_PALETTE[color]) {
        return COLOR_PALETTE[color];
    }
    
    // If it's already a hex code or CSS variable, return as is
    return color;
};

/**
 * Get border color with background color conflict detection
 * @param {string} collectionColor - Collection color to check
 * @returns {string} Border color that won't conflict with background
 */
export const getBorderColor = (collectionColor) => {
    const colorValue = getColorValue(collectionColor);
    
    // Define background colors for comparison (from CSS variables)
    const backgroundColors = {
        light: {
            normal: ['#fff', '#ffffff', 'var(--bg-color)'],
            expanded: ['#efefef', 'var(--setting-row-hover-bg-color)']
        },
        dark: {
            normal: ['#212121', 'var(--bg-color)'], 
            expanded: ['#2f343b', 'var(--setting-row-hover-bg-color)']
        }
    };
    
    // Get all possible background colors for current state
    const possibleBgColors = [
        ...backgroundColors.light.normal,
        ...backgroundColors.light.expanded,
        ...backgroundColors.dark.normal,
        ...backgroundColors.dark.expanded
    ];
    
    // Normalize color value for comparison
    const normalizedColorValue = colorValue.toLowerCase().trim();
    
    // Check if collection color matches any possible background color
    const matchesBackground = possibleBgColors.some(bgColor => {
        const normalizedBgColor = bgColor.toLowerCase().trim();
        return normalizedColorValue === normalizedBgColor ||
               normalizedColorValue === normalizedBgColor.replace('#ffffff', '#fff') ||
               normalizedColorValue === normalizedBgColor.replace('#fff', '#ffffff');
    });
    
    // Return fallback color if there's a conflict, otherwise return the collection color
    return matchesBackground ? 'var(--setting-row-border-color)' : colorValue;
};
