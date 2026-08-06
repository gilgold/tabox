import TaboxCollection from '../app/model/TaboxCollection';
import TaboxFolder from '../app/model/TaboxFolder';

describe('TaboxCollection', () => {
    test('creates collection with required parameters', () => {
        const tabs = [{ url: 'https://example.com', title: 'Example' }];
        const chromeGroups = [];
        
        const collection = new TaboxCollection('My Collection', tabs, chromeGroups);
        
        expect(collection.name).toBe('My Collection');
        expect(collection.tabs).toBe(tabs);
        expect(collection.chromeGroups).toBe(chromeGroups);
        expect(typeof collection.uid).toBe('string');
        expect(collection.uid.length).toBeGreaterThan(0);
    });

    test('generates unique UID', () => {
        const collection1 = new TaboxCollection('Collection 1', [], []);
        const collection2 = new TaboxCollection('Collection 2', [], []);
        
        expect(collection1.uid).not.toBe(collection2.uid);
    });

    test('uses default color if not provided', () => {
        const collection = new TaboxCollection('Test', [], []);
        
        expect(collection.color).toBe('var(--collection-default-color)');
    });

    test('uses provided color', () => {
        const collection = new TaboxCollection('Test', [], [], 'red');
        
        expect(collection.color).toBe('red');
    });

    test('sets createdOn to current time if not provided', () => {
        const before = Date.now();
        const collection = new TaboxCollection('Test', [], []);
        const after = Date.now();
        
        expect(collection.createdOn).toBeGreaterThanOrEqual(before);
        expect(collection.createdOn).toBeLessThanOrEqual(after);
    });

    test('preserves provided createdOn timestamp', () => {
        const createdOn = 1609459200000; // Jan 1, 2021
        const collection = new TaboxCollection('Test', [], [], null, createdOn);
        
        expect(collection.createdOn).toBe(createdOn);
    });

    test('sets lastUpdated to current time if not provided', () => {
        const before = Date.now();
        const collection = new TaboxCollection('Test', [], []);
        const after = Date.now();
        
        expect(collection.lastUpdated).toBeGreaterThanOrEqual(before);
        expect(collection.lastUpdated).toBeLessThanOrEqual(after);
    });

    test('preserves provided lastUpdated timestamp', () => {
        const lastUpdated = 1609459200000;
        const collection = new TaboxCollection('Test', [], [], null, null, null, lastUpdated);
        
        expect(collection.lastUpdated).toBe(lastUpdated);
    });

    test('preserves lastUpdated of 0', () => {
        const collection = new TaboxCollection('Test', [], [], null, null, null, 0);
        
        expect(collection.lastUpdated).toBe(0);
    });

    test('sets window property', () => {
        const window = { id: 1, focused: true };
        const collection = new TaboxCollection('Test', [], [], null, null, window);
        
        expect(collection.window).toEqual(window);
    });

    test('lastOpened defaults to null', () => {
        const collection = new TaboxCollection('Test', [], []);
        
        expect(collection.lastOpened).toBe(null);
    });

    test('preserves provided lastOpened timestamp', () => {
        const lastOpened = 1609459200000;
        const collection = new TaboxCollection('Test', [], [], null, null, null, null, lastOpened);
        
        expect(collection.lastOpened).toBe(lastOpened);
    });
});

describe('TaboxFolder', () => {
    test('creates folder with required parameters', () => {
        const folder = new TaboxFolder('My Folder');
        
        expect(folder.name).toBe('My Folder');
        expect(folder.type).toBe('folder');
        expect(typeof folder.uid).toBe('string');
        expect(folder.uid.length).toBeGreaterThan(0);
    });

    test('generates unique UID', () => {
        const folder1 = new TaboxFolder('Folder 1');
        const folder2 = new TaboxFolder('Folder 2');
        
        expect(folder1.uid).not.toBe(folder2.uid);
    });

    test('uses default color if not provided', () => {
        const folder = new TaboxFolder('Test');
        
        expect(folder.color).toBe('var(--folder-default-color)');
    });

    test('uses provided color', () => {
        const folder = new TaboxFolder('Test', '#FF5733');
        
        expect(folder.color).toBe('#FF5733');
    });

    test('sets createdOn to current time if not provided', () => {
        const before = Date.now();
        const folder = new TaboxFolder('Test');
        const after = Date.now();
        
        expect(folder.createdOn).toBeGreaterThanOrEqual(before);
        expect(folder.createdOn).toBeLessThanOrEqual(after);
    });

    test('preserves provided createdOn timestamp', () => {
        const createdOn = 1609459200000;
        const folder = new TaboxFolder('Test', null, createdOn);
        
        expect(folder.createdOn).toBe(createdOn);
    });

    test('sets lastUpdated to current time if not provided', () => {
        const before = Date.now();
        const folder = new TaboxFolder('Test');
        const after = Date.now();
        
        expect(folder.lastUpdated).toBeGreaterThanOrEqual(before);
        expect(folder.lastUpdated).toBeLessThanOrEqual(after);
    });

    test('preserves provided lastUpdated timestamp', () => {
        const lastUpdated = 1609459200000;
        const folder = new TaboxFolder('Test', null, null, lastUpdated);
        
        expect(folder.lastUpdated).toBe(lastUpdated);
    });

    test('preserves lastUpdated of 0', () => {
        const folder = new TaboxFolder('Test', null, null, 0);
        
        expect(folder.lastUpdated).toBe(0);
    });

    test('collapsed defaults to false', () => {
        const folder = new TaboxFolder('Test');
        
        expect(folder.collapsed).toBe(false);
    });

    test('uses provided collapsed state', () => {
        const folder = new TaboxFolder('Test', null, null, null, true);
        
        expect(folder.collapsed).toBe(true);
    });

    test('has default order of 999999', () => {
        const folder = new TaboxFolder('Test');
        
        expect(folder.order).toBe(999999);
    });

    test('has default collectionCount of 0', () => {
        const folder = new TaboxFolder('Test');
        
        expect(folder.collectionCount).toBe(0);
    });
});
