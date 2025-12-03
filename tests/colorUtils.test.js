import { tabGroupColorChart, getColorCode, getBorderColor } from '../app/utils/colorUtils';

describe('tabGroupColorChart', () => {
    test('contains expected color mappings', () => {
        expect(tabGroupColorChart).toEqual({
            'grey': '#54585d',
            'blue': '#1b68de',
            'red': '#d22c28',
            'yellow': '#fcd065',
            'green': '#21823d',
            'pink': '#fd80c2',
            'purple': '#872fdb',
            'orange': '#fcad6f',
            'cyan': '#6fd3e7'
        });
    });

    test('has 9 color entries', () => {
        expect(Object.keys(tabGroupColorChart)).toHaveLength(9);
    });
});

describe('getColorCode', () => {
    test('returns hex code for known color names', () => {
        expect(getColorCode('grey')).toBe('#54585d');
        expect(getColorCode('blue')).toBe('#1b68de');
        expect(getColorCode('red')).toBe('#d22c28');
        expect(getColorCode('yellow')).toBe('#fcd065');
        expect(getColorCode('green')).toBe('#21823d');
        expect(getColorCode('pink')).toBe('#fd80c2');
        expect(getColorCode('purple')).toBe('#872fdb');
        expect(getColorCode('orange')).toBe('#fcad6f');
        expect(getColorCode('cyan')).toBe('#6fd3e7');
    });

    test('handles uppercase color names', () => {
        expect(getColorCode('BLUE')).toBe('#1b68de');
        expect(getColorCode('RED')).toBe('#d22c28');
    });

    test('handles mixed case color names', () => {
        expect(getColorCode('Blue')).toBe('#1b68de');
        expect(getColorCode('ReD')).toBe('#d22c28');
    });

    test('returns original value for unknown color names', () => {
        expect(getColorCode('unknown')).toBe('unknown');
        expect(getColorCode('#custom123')).toBe('#custom123');
    });

    test('returns null/undefined unchanged', () => {
        expect(getColorCode(null)).toBe(null);
        expect(getColorCode(undefined)).toBe(undefined);
    });

    test('returns empty string unchanged', () => {
        expect(getColorCode('')).toBe('');
    });
});

describe('getBorderColor', () => {
    test('returns color value for normal colors', () => {
        // Normal colors should be returned (through getColorValue)
        expect(getBorderColor('red')).toBe('#DC2626');
        expect(getBorderColor('blue')).toBe('#2563EB');
        expect(getBorderColor('green')).toBe('#16A34A');
    });

    test('returns fallback for white backgrounds in light mode', () => {
        // Colors that match light mode backgrounds should return fallback
        expect(getBorderColor('#fff')).toBe('var(--setting-row-border-color)');
        expect(getBorderColor('#ffffff')).toBe('var(--setting-row-border-color)');
    });

    test('returns fallback for dark backgrounds in dark mode', () => {
        // Colors that match dark mode backgrounds should return fallback
        expect(getBorderColor('#212121')).toBe('var(--setting-row-border-color)');
    });

    test('returns fallback for expanded row backgrounds', () => {
        expect(getBorderColor('#efefef')).toBe('var(--setting-row-border-color)');
        expect(getBorderColor('#2f343b')).toBe('var(--setting-row-border-color)');
    });

    test('returns fallback for null/undefined', () => {
        expect(getBorderColor(null)).toBe('var(--setting-row-border-color)');
        expect(getBorderColor(undefined)).toBe('var(--setting-row-border-color)');
    });

    test('handles CSS variable values', () => {
        expect(getBorderColor('var(--bg-color)')).toBe('var(--setting-row-border-color)');
    });

    test('returns hex colors that do not conflict with backgrounds', () => {
        // A custom hex color that doesn't match backgrounds should be returned
        expect(getBorderColor('#FF5733')).toBe('#FF5733');
        expect(getBorderColor('#123456')).toBe('#123456');
    });

    test('handles case insensitivity for hex colors', () => {
        expect(getBorderColor('#FFF')).toBe('var(--setting-row-border-color)');
        expect(getBorderColor('#FFFFFF')).toBe('var(--setting-row-border-color)');
    });
});

