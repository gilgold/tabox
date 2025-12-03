import { applyUid, generateCopyName } from '../app/utils';
import TaboxCollection from '../app/model/TaboxCollection';

describe('applyUid', () => {
    test('returns item unchanged if null or undefined', () => {
        expect(applyUid(null)).toBe(null);
        expect(applyUid(undefined)).toBe(undefined);
    });

    test('returns item unchanged if no tabs property', () => {
        const item = { name: 'Test' };
        expect(applyUid(item)).toEqual(item);
    });

    test('returns item unchanged if tabs array is empty', () => {
        const item = { name: 'Test', tabs: [] };
        expect(applyUid(item)).toEqual(item);
    });

    test('applies UIDs to tabs', () => {
        const item = {
            name: 'Test Collection',
            tabs: [
                { url: 'https://example.com', title: 'Example' },
                { url: 'https://test.com', title: 'Test' }
            ],
            chromeGroups: []
        };

        const result = applyUid(item);

        // Check UIDs are strings and unique
        expect(typeof result.tabs[0].uid).toBe('string');
        expect(typeof result.tabs[1].uid).toBe('string');
        expect(result.tabs[0].uid).not.toBe(result.tabs[1].uid);
    });

    test('applies UIDs to chrome groups and links tabs to groups', () => {
        const item = {
            name: 'Test Collection',
            tabs: [
                { url: 'https://example.com', title: 'Example', groupId: 1 },
                { url: 'https://test.com', title: 'Test', groupId: 1 },
                { url: 'https://other.com', title: 'Other', groupId: -1 }
            ],
            chromeGroups: [
                { id: 1, title: 'Group 1', color: 'blue' }
            ]
        };

        const result = applyUid(item);

        // Check group got UID
        expect(typeof result.chromeGroups[0].uid).toBe('string');
        
        // Check tabs in group have matching groupUid
        const groupUid = result.chromeGroups[0].uid;
        expect(result.tabs[0].groupUid).toBe(groupUid);
        expect(result.tabs[1].groupUid).toBe(groupUid);
        
        // Tab not in group should not have groupUid
        expect(result.tabs[2].groupUid).toBeUndefined();
    });

    test('preserves original collection UID if it exists', () => {
        const item = {
            uid: 'original-uid',
            name: 'Test Collection',
            tabs: [{ url: 'https://example.com', title: 'Example' }],
            chromeGroups: []
        };

        const result = applyUid(item);

        expect(result.uid).toBe('original-uid');
    });

    test('preserves parentId if it exists', () => {
        const item = {
            name: 'Test Collection',
            tabs: [{ url: 'https://example.com', title: 'Example' }],
            chromeGroups: [],
            parentId: 'folder-123'
        };

        const result = applyUid(item);

        expect(result.parentId).toBe('folder-123');
    });

    test('preserves parentId when null (root level)', () => {
        const item = {
            name: 'Test Collection',
            tabs: [{ url: 'https://example.com', title: 'Example' }],
            chromeGroups: [],
            parentId: null
        };

        const result = applyUid(item);

        expect(result.parentId).toBe(null);
    });

    test('preserves timestamps', () => {
        const createdOn = Date.now() - 10000;
        const lastUpdated = Date.now() - 5000;
        const lastOpened = Date.now() - 1000;
        
        const item = {
            name: 'Test Collection',
            tabs: [{ url: 'https://example.com', title: 'Example' }],
            chromeGroups: [],
            createdOn,
            lastUpdated,
            lastOpened
        };

        const result = applyUid(item);

        expect(result.createdOn).toBe(createdOn);
        expect(result.lastUpdated).toBe(lastUpdated);
        expect(result.lastOpened).toBe(lastOpened);
    });

    test('returns a TaboxCollection instance', () => {
        const item = {
            name: 'Test Collection',
            tabs: [{ url: 'https://example.com', title: 'Example' }],
            chromeGroups: []
        };

        const result = applyUid(item);

        expect(result).toBeInstanceOf(TaboxCollection);
    });
});

describe('generateCopyName', () => {
    test('returns "(copy)" suffix when name does not exist', () => {
        const existingCollections = [
            { name: 'Collection A' },
            { name: 'Collection B' }
        ];

        const result = generateCopyName('My Collection', existingCollections);

        expect(result).toBe('My Collection (copy)');
    });

    test('returns "(copy 2)" when "(copy)" already exists', () => {
        const existingCollections = [
            { name: 'My Collection' },
            { name: 'My Collection (copy)' }
        ];

        const result = generateCopyName('My Collection', existingCollections);

        expect(result).toBe('My Collection (copy 2)');
    });

    test('increments copy number when multiple copies exist', () => {
        const existingCollections = [
            { name: 'My Collection' },
            { name: 'My Collection (copy)' },
            { name: 'My Collection (copy 2)' },
            { name: 'My Collection (copy 3)' }
        ];

        const result = generateCopyName('My Collection', existingCollections);

        expect(result).toBe('My Collection (copy 4)');
    });

    test('extracts base name when copying a copy', () => {
        const existingCollections = [
            { name: 'My Collection' },
            { name: 'My Collection (copy)' }
        ];

        // When copying "My Collection (copy)", should use base name "My Collection"
        const result = generateCopyName('My Collection (copy)', existingCollections);

        expect(result).toBe('My Collection (copy 2)');
    });

    test('extracts base name when copying a numbered copy', () => {
        const existingCollections = [
            { name: 'My Collection' },
            { name: 'My Collection (copy)' },
            { name: 'My Collection (copy 2)' }
        ];

        // When copying "My Collection (copy 2)", should use base name "My Collection"
        const result = generateCopyName('My Collection (copy 2)', existingCollections);

        expect(result).toBe('My Collection (copy 3)');
    });

    test('handles empty existing collections', () => {
        const result = generateCopyName('My Collection', []);

        expect(result).toBe('My Collection (copy)');
    });

    test('handles names with special characters', () => {
        const existingCollections = [
            { name: 'Work (Important!)' }
        ];

        const result = generateCopyName('Work (Important!)', existingCollections);

        expect(result).toBe('Work (Important!) (copy)');
    });

    test('handles names that contain word "copy" naturally', () => {
        const existingCollections = [
            { name: 'Copy of Documents' }
        ];

        const result = generateCopyName('Copy of Documents', existingCollections);

        expect(result).toBe('Copy of Documents (copy)');
    });
});

