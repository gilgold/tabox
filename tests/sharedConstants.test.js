import { STORAGE_KEYS, CURRENT_STORAGE_VERSION, generateUid } from '../app/utils/sharedConstants';

describe('STORAGE_KEYS', () => {
    test('contains expected storage key constants', () => {
        expect(STORAGE_KEYS.COLLECTIONS_INDEX).toBe('collections_index');
        expect(STORAGE_KEYS.FOLDERS_INDEX).toBe('folders_index');
        expect(STORAGE_KEYS.LEGACY_TABS_ARRAY).toBe('tabsArray');
        expect(STORAGE_KEYS.COLLECTION_PREFIX).toBe('collection_');
        expect(STORAGE_KEYS.FOLDER_PREFIX).toBe('folder_');
        expect(STORAGE_KEYS.STORAGE_VERSION).toBe('tabox_storage_version');
    });

    test('has all expected keys', () => {
        const expectedKeys = [
            'COLLECTIONS_INDEX',
            'FOLDERS_INDEX',
            'LEGACY_TABS_ARRAY',
            'COLLECTION_PREFIX',
            'FOLDER_PREFIX',
            'STORAGE_VERSION'
        ];
        
        expect(Object.keys(STORAGE_KEYS).sort()).toEqual(expectedKeys.sort());
    });
});

describe('CURRENT_STORAGE_VERSION', () => {
    test('is a number', () => {
        expect(typeof CURRENT_STORAGE_VERSION).toBe('number');
    });

    test('is version 3', () => {
        expect(CURRENT_STORAGE_VERSION).toBe(3);
    });
});

describe('generateUid', () => {
    test('returns a string', () => {
        const result = generateUid();
        
        expect(typeof result).toBe('string');
    });

    test('returns non-empty string', () => {
        const result = generateUid();
        
        expect(result.length).toBeGreaterThan(0);
    });

    test('generates unique IDs on subsequent calls', () => {
        const uid1 = generateUid();
        const uid2 = generateUid();
        const uid3 = generateUid();
        
        expect(uid1).not.toBe(uid2);
        expect(uid2).not.toBe(uid3);
        expect(uid1).not.toBe(uid3);
    });

    test('generates IDs of reasonable length', () => {
        const result = generateUid();
        
        // UUID format is typically 36 chars, random fallback is shorter but still substantial
        expect(result.length).toBeGreaterThanOrEqual(10);
    });
});

