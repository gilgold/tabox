import { 
    COLOR_PALETTE, 
    migrateColor, 
    migrateAllCollectionColors, 
    getColorValue 
} from '../app/utils/colorMigration';

describe('COLOR_PALETTE', () => {
    test('contains all expected colors', () => {
        expect(COLOR_PALETTE).toHaveProperty('default');
        expect(COLOR_PALETTE).toHaveProperty('red');
        expect(COLOR_PALETTE).toHaveProperty('orange-red');
        expect(COLOR_PALETTE).toHaveProperty('yellow');
        expect(COLOR_PALETTE).toHaveProperty('green');
        expect(COLOR_PALETTE).toHaveProperty('blue');
        expect(COLOR_PALETTE).toHaveProperty('dark-blue');
        expect(COLOR_PALETTE).toHaveProperty('purple');
        expect(COLOR_PALETTE).toHaveProperty('light-red');
        expect(COLOR_PALETTE).toHaveProperty('light-orange');
        expect(COLOR_PALETTE).toHaveProperty('light-yellow');
        expect(COLOR_PALETTE).toHaveProperty('light-green');
        expect(COLOR_PALETTE).toHaveProperty('cyan');
        expect(COLOR_PALETTE).toHaveProperty('light-blue');
        expect(COLOR_PALETTE).toHaveProperty('pale-blue');
        expect(COLOR_PALETTE).toHaveProperty('sky-blue');
        expect(COLOR_PALETTE).toHaveProperty('light-purple');
    });

    test('default color is CSS variable', () => {
        expect(COLOR_PALETTE['default']).toBe('var(--setting-row-border-color)');
    });

    test('colors are valid hex codes or CSS variables', () => {
        Object.entries(COLOR_PALETTE).forEach(([name, value]) => {
            if (name !== 'default') {
                expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
            }
        });
    });
});

describe('migrateColor', () => {
    test('returns "default" for null/undefined', () => {
        expect(migrateColor(null)).toBe('default');
        expect(migrateColor(undefined)).toBe('default');
        expect(migrateColor('')).toBe('default');
    });

    test('returns color name unchanged if already in new format', () => {
        expect(migrateColor('red')).toBe('red');
        expect(migrateColor('blue')).toBe('blue');
        expect(migrateColor('green')).toBe('green');
        expect(migrateColor('purple')).toBe('purple');
        expect(migrateColor('default')).toBe('default');
    });

    test('migrates legacy hex colors to new names', () => {
        // Test uppercase legacy colors
        expect(migrateColor('#B60205')).toBe('red');
        expect(migrateColor('#D93F0B')).toBe('orange-red');
        expect(migrateColor('#FBCA04')).toBe('yellow');
        expect(migrateColor('#0E8A16')).toBe('green');
        expect(migrateColor('#1D76DB')).toBe('blue');
        expect(migrateColor('#0052CC')).toBe('dark-blue');
        expect(migrateColor('#6330e4')).toBe('purple');
    });

    test('migrates lowercase legacy colors', () => {
        expect(migrateColor('#b60205')).toBe('red');
        expect(migrateColor('#d93f0b')).toBe('orange-red');
        expect(migrateColor('#fbca04')).toBe('yellow');
        expect(migrateColor('#0e8a16')).toBe('green');
        expect(migrateColor('#1d76db')).toBe('blue');
    });

    test('migrates light colors', () => {
        expect(migrateColor('#f78786')).toBe('light-red');
        expect(migrateColor('#f1bc97')).toBe('light-orange');
        expect(migrateColor('#f3e3a2')).toBe('light-yellow');
        expect(migrateColor('#95e6b2')).toBe('light-green');
        expect(migrateColor('#acf4f9')).toBe('cyan');
        expect(migrateColor('#99bdff')).toBe('light-blue');
        expect(migrateColor('#C5DEF5')).toBe('pale-blue');
        expect(migrateColor('#6294dc')).toBe('sky-blue');
        expect(migrateColor('#b499f7')).toBe('light-purple');
    });

    test('migrates CSS variable for default', () => {
        expect(migrateColor('var(--setting-row-border-color)')).toBe('default');
    });

    test('finds closest color for unknown hex codes', () => {
        // Unknown hex codes should find a closest match
        const result = migrateColor('#FF0000');
        expect(typeof result).toBe('string');
        // Should return a color name from the palette
        expect(Object.keys(COLOR_PALETTE)).toContain(result);
    });
});

describe('migrateAllCollectionColors', () => {
    test('returns non-array input unchanged', () => {
        expect(migrateAllCollectionColors(null)).toBe(null);
        expect(migrateAllCollectionColors(undefined)).toBe(undefined);
        expect(migrateAllCollectionColors('string')).toBe('string');
        expect(migrateAllCollectionColors(123)).toBe(123);
    });

    test('returns empty array unchanged', () => {
        expect(migrateAllCollectionColors([])).toEqual([]);
    });

    test('migrates collection colors', () => {
        const collections = [
            { name: 'Collection 1', color: '#B60205', tabs: [] },
            { name: 'Collection 2', color: '#1D76DB', tabs: [] }
        ];

        const result = migrateAllCollectionColors(collections);

        expect(result[0].color).toBe('red');
        expect(result[1].color).toBe('blue');
    });

    test('preserves collections with new color format', () => {
        const collections = [
            { name: 'Collection 1', color: 'red', tabs: [] },
            { name: 'Collection 2', color: 'blue', tabs: [] }
        ];

        const result = migrateAllCollectionColors(collections);

        expect(result[0].color).toBe('red');
        expect(result[1].color).toBe('blue');
    });

    test('handles collections without color property', () => {
        const collections = [
            { name: 'Collection 1', tabs: [] }
        ];

        const result = migrateAllCollectionColors(collections);

        expect(result[0].color).toBeUndefined();
    });

    test('migrates chromeGroup colors', () => {
        const collections = [
            {
                name: 'Collection 1',
                color: 'red',
                tabs: [],
                chromeGroups: [
                    { id: 1, title: 'Group 1', color: '#B60205' },
                    { id: 2, title: 'Group 2', color: '#1D76DB' }
                ]
            }
        ];

        const result = migrateAllCollectionColors(collections);

        expect(result[0].chromeGroups[0].color).toBe('red');
        expect(result[0].chromeGroups[1].color).toBe('blue');
    });

    test('preserves other collection properties', () => {
        const collections = [
            {
                uid: 'test-uid',
                name: 'Collection 1',
                color: '#B60205',
                tabs: [{ url: 'https://example.com' }],
                createdOn: 12345,
                lastUpdated: 67890
            }
        ];

        const result = migrateAllCollectionColors(collections);

        expect(result[0].uid).toBe('test-uid');
        expect(result[0].name).toBe('Collection 1');
        expect(result[0].tabs).toEqual([{ url: 'https://example.com' }]);
        expect(result[0].createdOn).toBe(12345);
        expect(result[0].lastUpdated).toBe(67890);
    });
});

describe('getColorValue', () => {
    test('returns default for null/undefined', () => {
        expect(getColorValue(null)).toBe(COLOR_PALETTE['default']);
        expect(getColorValue(undefined)).toBe(COLOR_PALETTE['default']);
        expect(getColorValue('')).toBe(COLOR_PALETTE['default']);
    });

    test('returns hex value for palette color names', () => {
        expect(getColorValue('red')).toBe('#DC2626');
        expect(getColorValue('blue')).toBe('#2563EB');
        expect(getColorValue('green')).toBe('#16A34A');
        expect(getColorValue('purple')).toBe('#7C3AED');
    });

    test('returns hex codes as-is', () => {
        expect(getColorValue('#FF5733')).toBe('#FF5733');
        expect(getColorValue('#123456')).toBe('#123456');
    });

    test('returns CSS variables as-is', () => {
        expect(getColorValue('var(--custom-color)')).toBe('var(--custom-color)');
        expect(getColorValue('var(--bg-color)')).toBe('var(--bg-color)');
    });

    test('returns default for unknown color names', () => {
        expect(getColorValue('unknown-color')).toBe(COLOR_PALETTE['default']);
        expect(getColorValue('notacolor')).toBe(COLOR_PALETTE['default']);
    });
});

