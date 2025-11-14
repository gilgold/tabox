/**
 * Color Migration Utility
 * Maps old hex color codes to new named color system
 */

// New color system with names and hex values
export const COLOR_PALETTE = {
    'default': 'var(--setting-row-border-color)',
    'red': '#DC2626',
    'orange-red': '#EA580C', 
    'yellow': '#F59E0B',
    'green': '#16A34A',
    'blue': '#2563EB',
    'dark-blue': '#1D4ED8',
    'purple': '#7C3AED',
    'light-red': '#F87171',
    'light-orange': '#FB923C',
    'light-yellow': '#FDE047',
    'light-green': '#4ADE80',
    'cyan': '#22D3EE',
    'light-blue': '#60A5FA',
    'pale-blue': '#A5B4FC',
    'sky-blue': '#3B82F6',
    'light-purple': '#C084FC'
};

// Legacy color mapping - maps old hex codes to new color names
const LEGACY_COLOR_MAPPING = {
    // Old color -> New color name
    '#B60205': 'red',           // Old dark red -> Enhanced red
    '#D93F0B': 'orange-red',    // Old orange-red -> Improved orange-red
    '#FBCA04': 'yellow',        // Old yellow -> Refined yellow
    '#0E8A16': 'green',         // Old green -> Enhanced green
    '#1D76DB': 'blue',          // Old blue -> Improved blue
    '#0052CC': 'dark-blue',     // Old dark blue -> Distinct darker blue
    '#6330e4': 'purple',        // Old purple -> Enhanced purple
    '#f78786': 'light-red',     // Old light red -> Refined light red
    '#f1bc97': 'light-orange',  // Old peach -> Improved light orange
    '#f3e3a2': 'light-yellow',  // Old light yellow -> Enhanced light yellow
    '#95e6b2': 'light-green',   // Old light green -> Refined light green
    '#acf4f9': 'cyan',          // Old cyan -> Improved cyan
    '#99bdff': 'light-blue',    // Old light blue -> Enhanced light blue
    '#C5DEF5': 'pale-blue',     // Old very light blue -> Refined very light blue
    '#6294dc': 'sky-blue',      // Old medium blue -> Improved medium blue
    '#b499f7': 'light-purple',  // Old light purple -> Enhanced light purple
    
    // Handle case variations
    '#b60205': 'red',
    '#d93f0b': 'orange-red',
    '#fbca04': 'yellow',
    '#0e8a16': 'green',
    '#1d76db': 'blue',
    '#ACCCF9': 'cyan',          // Alternative old cyan
    '#B499F7': 'light-purple',  // Alternative old light purple
    
    // Additional legacy colors that might exist
    'var(--setting-row-border-color)': 'default'
};

/**
 * Migrate a single color from old hex code to new color name
 * @param {string} oldColor - Old hex color code
 * @returns {string} New color name or the color value if no migration needed
 */
export const migrateColor = (oldColor) => {
    if (!oldColor) return 'default';
    
    // If it's already a color name from the new system, return as is
    if (COLOR_PALETTE[oldColor]) {
        return oldColor;
    }
    
    // Check if it's a legacy hex code that needs migration
    const newColorName = LEGACY_COLOR_MAPPING[oldColor];
    if (newColorName) {
        console.log(`🎨 Migrating color: ${oldColor} → ${newColorName} (${COLOR_PALETTE[newColorName]})`);
        return newColorName;
    }
    
    // If it's a valid hex code but not in our legacy mapping, try to find closest match
    if (oldColor.startsWith('#')) {
        const closestColor = findClosestColor(oldColor);
        if (closestColor) {
            console.log(`🎨 Mapping unknown color: ${oldColor} → ${closestColor} (${COLOR_PALETTE[closestColor]})`);
            return closestColor;
        }
    }
    
    // If no migration possible, return default
    console.warn(`⚠️ Unknown color format: ${oldColor}, using default`);
    return 'default';
};

/**
 * Migrate collection colors from old hex codes to new color names
 * @param {object} collection - Collection object with potential old colors
 * @returns {object} Collection with migrated colors
 */
export const migrateCollectionColors = (collection) => {
    if (!collection) return collection;
    
    const migratedCollection = { ...collection };
    let colorsMigrated = false;
    
    // Migrate main collection color
    if (collection.color) {
        const newColor = migrateColor(collection.color);
        if (newColor !== collection.color) {
            migratedCollection.color = newColor;
            colorsMigrated = true;
        }
    }
    
    // Migrate group colors if they exist
    if (collection.chromeGroups && Array.isArray(collection.chromeGroups)) {
        migratedCollection.chromeGroups = collection.chromeGroups.map(group => {
            if (group.color) {
                const newColor = migrateColor(group.color);
                if (newColor !== group.color) {
                    colorsMigrated = true;
                    return { ...group, color: newColor };
                }
            }
            return group;
        });
    }
    
    if (colorsMigrated) {
        console.log(`🎨 Migrated colors for collection: ${collection.name}`);
    }
    
    return migratedCollection;
};

/**
 * Migrate all collections in an array
 * @param {Array} collections - Array of collection objects
 * @returns {Array} Array of collections with migrated colors
 */
export const migrateAllCollectionColors = (collections) => {
    if (!Array.isArray(collections)) return collections;
    
    let totalMigrations = 0;
    const migratedCollections = collections.map(collection => {
        const originalColor = collection.color;
        const migratedCollection = migrateCollectionColors(collection);
        
        if (migratedCollection.color !== originalColor) {
            totalMigrations++;
        }
        
        return migratedCollection;
    });
    
    if (totalMigrations > 0) {
        console.log(`🎨 Color migration complete: ${totalMigrations} collections updated`);
    }
    
    return migratedCollections;
};

/**
 * Find the closest color match for an unknown hex code
 * @param {string} hexColor - Hex color code to match
 * @returns {string|null} Closest color name or null if no good match
 */
const findClosestColor = (hexColor) => {
    // Simple heuristic-based matching for common color ranges
    const hex = hexColor.toLowerCase();
    
    // Red family
    if (hex.includes('b6') || hex.includes('d9') || hex.includes('c2') || hex.includes('f8')) {
        return 'red';
    }
    
    // Green family  
    if (hex.includes('0e') || hex.includes('16') || hex.includes('95')) {
        return 'green';
    }
    
    // Blue family
    if (hex.includes('1d') || hex.includes('52') || hex.includes('99') || hex.includes('62')) {
        return 'blue';
    }
    
    // Purple family
    if (hex.includes('63') || hex.includes('b4')) {
        return 'purple';
    }
    
    // Yellow family
    if (hex.includes('fb') || hex.includes('f3')) {
        return 'yellow';
    }
    
    // Default to a safe choice
    return 'blue';
};

/**
 * Get color hex value by name or return existing hex/CSS value
 * @param {string} colorName - Color name or hex code
 * @returns {string} Hex color value or CSS variable
 */
export const getColorValue = (colorName) => {
    if (!colorName) return COLOR_PALETTE['default'];
    
    // If it's a color name from our palette, return its hex value
    if (COLOR_PALETTE[colorName]) {
        return COLOR_PALETTE[colorName];
    }
    
    // If it's already a hex code (starts with #) or CSS variable (starts with var(--), return as-is
    if (colorName.startsWith('#') || colorName.startsWith('var(--')) {
        return colorName;
    }
    
    // If it's an unknown format, return default
    return COLOR_PALETTE['default'];
};

/**
 * Get all available color names
 * @returns {Array} Array of color names
 */
export const getColorNames = () => {
    return Object.keys(COLOR_PALETTE);
};

/**
 * Validate if a color name exists in the palette
 * @param {string} colorName - Color name to validate
 * @returns {boolean} True if color exists
 */
export const isValidColorName = (colorName) => {
    return Object.prototype.hasOwnProperty.call(COLOR_PALETTE, colorName);
}; 