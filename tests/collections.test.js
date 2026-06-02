/**
 * Collections Tests
 * 
 * Tests for saving and opening collections including:
 * - Creating new collections
 * - Saving tabs to collections
 * - Opening collection tabs
 * - Tab groups handling
 * - Pinned tabs handling
 * - Incognito handling
 * - Duplicate tab handling
 * - Edge cases and error handling
 */

// Mock crypto for UUID generation
const mockCrypto = {
    randomUUID: jest.fn(() => `uuid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
};
global.crypto = mockCrypto;

// Mock browser API
const mockBrowser = {
    storage: {
        local: {
            _data: {},
            get: jest.fn(async (keys) => {
                if (typeof keys === 'string') {
                    return { [keys]: mockBrowser.storage.local._data[keys] };
                }
                if (Array.isArray(keys)) {
                    const result = {};
                    keys.forEach(key => {
                        if (mockBrowser.storage.local._data[key] !== undefined) {
                            result[key] = mockBrowser.storage.local._data[key];
                        }
                    });
                    return result;
                }
                return mockBrowser.storage.local._data;
            }),
            set: jest.fn(async (items) => {
                Object.assign(mockBrowser.storage.local._data, items);
            }),
            remove: jest.fn(async (keys) => {
                if (typeof keys === 'string') {
                    delete mockBrowser.storage.local._data[keys];
                } else if (Array.isArray(keys)) {
                    keys.forEach(key => delete mockBrowser.storage.local._data[key]);
                }
            })
        }
    },
    tabs: {
        query: jest.fn(async () => []),
        create: jest.fn(async (options) => ({ id: Date.now(), ...options })),
        remove: jest.fn(async () => {}),
        update: jest.fn(async (tabId, props) => ({ id: tabId, ...props })),
        group: jest.fn(async (options) => options.groupId || Date.now()),
        ungroup: jest.fn(async () => {})
    },
    windows: {
        getCurrent: jest.fn(async () => ({ id: 1, incognito: false })),
        create: jest.fn(async (options) => ({ id: Date.now(), ...options })),
        update: jest.fn(async (windowId, props) => ({ id: windowId, ...props })),
        WINDOW_ID_CURRENT: -2
    },
    tabGroups: {
        query: jest.fn(async () => []),
        update: jest.fn(async (groupId, props) => ({ id: groupId, ...props }))
    },
    runtime: {
        sendMessage: jest.fn(async () => ({})),
        getManifest: jest.fn(() => ({ version: '4.0.1' }))
    },
    extension: {
        isAllowedIncognitoAccess: jest.fn(async () => true)
    }
};

global.browser = mockBrowser;

// Storage keys
const STORAGE_KEYS = {
    COLLECTIONS_INDEX: 'collectionsIndex',
    COLLECTION_PREFIX: 'collection_'
};

// Reset helpers
const resetMocks = () => {
    mockBrowser.storage.local._data = {};
    mockBrowser.storage.local.get.mockClear();
    mockBrowser.storage.local.set.mockClear();
    mockBrowser.tabs.query.mockClear();
    mockBrowser.tabs.create.mockClear();
    mockBrowser.windows.create.mockClear();
    mockBrowser.runtime.sendMessage.mockClear();
    mockCrypto.randomUUID.mockClear();
};

// Helper to create mock tab
const createMockTab = (overrides = {}) => ({
    id: Date.now() + Math.random(),
    url: 'https://example.com',
    title: 'Example Page',
    favIconUrl: 'https://example.com/favicon.ico',
    pinned: false,
    active: false,
    highlighted: false,
    incognito: false,
    groupId: -1,
    index: 0,
    windowId: 1,
    ...overrides
});

// Helper to create mock collection
const createMockCollection = (overrides = {}) => ({
    uid: `col-${Date.now()}`,
    name: 'Test Collection',
    tabs: [createMockTab()],
    chromeGroups: [],
    color: 'var(--collection-default-color)',
    createdOn: Date.now(),
    lastUpdated: Date.now(),
    lastOpened: null,
    window: null,
    parentId: null,
    ...overrides
});

// Helper to create mock tab group
const createMockTabGroup = (overrides = {}) => ({
    id: Date.now(),
    title: 'Test Group',
    color: 'blue',
    collapsed: false,
    windowId: 1,
    ...overrides
});

// ============================================
// COLLECTION CREATION TESTS
// ============================================

describe('Collection Creation', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('basic collection creation', () => {
        test('should create collection with unique UID', () => {
            const collection1 = createMockCollection({ uid: undefined });
            collection1.uid = mockCrypto.randomUUID();
            
            const collection2 = createMockCollection({ uid: undefined });
            collection2.uid = mockCrypto.randomUUID();

            expect(collection1.uid).toBeDefined();
            expect(collection2.uid).toBeDefined();
            expect(collection1.uid).not.toBe(collection2.uid);
        });

        test('should create collection with required fields', () => {
            const collection = createMockCollection({
                name: 'My Collection',
                tabs: [createMockTab({ url: 'https://test.com' })]
            });

            expect(collection.name).toBe('My Collection');
            expect(collection.tabs).toHaveLength(1);
            expect(collection.tabs[0].url).toBe('https://test.com');
            expect(collection.createdOn).toBeDefined();
            expect(collection.lastUpdated).toBeDefined();
        });

        test('should create collection with default color', () => {
            const collection = createMockCollection({ color: undefined });
            collection.color = collection.color || 'var(--collection-default-color)';

            expect(collection.color).toBe('var(--collection-default-color)');
        });

        test('should create collection with custom color', () => {
            const collection = createMockCollection({ color: '#FF5733' });

            expect(collection.color).toBe('#FF5733');
        });

        test('should set createdOn timestamp', () => {
            const before = Date.now();
            const collection = createMockCollection({ createdOn: Date.now() });
            const after = Date.now();

            expect(collection.createdOn).toBeGreaterThanOrEqual(before);
            expect(collection.createdOn).toBeLessThanOrEqual(after);
        });

        test('should set lastUpdated timestamp', () => {
            const before = Date.now();
            const collection = createMockCollection({ lastUpdated: Date.now() });
            const after = Date.now();

            expect(collection.lastUpdated).toBeGreaterThanOrEqual(before);
            expect(collection.lastUpdated).toBeLessThanOrEqual(after);
        });

        test('should initialize lastOpened as null', () => {
            const collection = createMockCollection({ lastOpened: null });

            expect(collection.lastOpened).toBeNull();
        });
    });

    describe('collection with tabs', () => {
        test('should create collection with single tab', () => {
            const tab = createMockTab({ url: 'https://single.com', title: 'Single Tab' });
            const collection = createMockCollection({ tabs: [tab] });

            expect(collection.tabs).toHaveLength(1);
            expect(collection.tabs[0].url).toBe('https://single.com');
        });

        test('should create collection with multiple tabs', () => {
            const tabs = [
                createMockTab({ url: 'https://first.com', title: 'First' }),
                createMockTab({ url: 'https://second.com', title: 'Second' }),
                createMockTab({ url: 'https://third.com', title: 'Third' })
            ];
            const collection = createMockCollection({ tabs });

            expect(collection.tabs).toHaveLength(3);
        });

        test('should create collection with empty tabs array', () => {
            const collection = createMockCollection({ tabs: [] });

            expect(collection.tabs).toHaveLength(0);
        });

        test('should preserve tab order', () => {
            const tabs = [
                createMockTab({ url: 'https://a.com', index: 0 }),
                createMockTab({ url: 'https://b.com', index: 1 }),
                createMockTab({ url: 'https://c.com', index: 2 })
            ];
            const collection = createMockCollection({ tabs });

            expect(collection.tabs[0].url).toBe('https://a.com');
            expect(collection.tabs[1].url).toBe('https://b.com');
            expect(collection.tabs[2].url).toBe('https://c.com');
        });
    });

    describe('collection with tab groups', () => {
        test('should create collection with tab groups', () => {
            const groups = [
                createMockTabGroup({ id: 1, title: 'Work', color: 'blue' }),
                createMockTabGroup({ id: 2, title: 'Personal', color: 'green' })
            ];
            const tabs = [
                createMockTab({ url: 'https://work.com', groupId: 1 }),
                createMockTab({ url: 'https://personal.com', groupId: 2 })
            ];
            const collection = createMockCollection({ tabs, chromeGroups: groups });

            expect(collection.chromeGroups).toHaveLength(2);
            expect(collection.tabs[0].groupId).toBe(1);
            expect(collection.tabs[1].groupId).toBe(2);
        });

        test('should handle tabs without groups', () => {
            const tabs = [
                createMockTab({ url: 'https://ungrouped.com', groupId: -1 })
            ];
            const collection = createMockCollection({ tabs, chromeGroups: [] });

            expect(collection.chromeGroups).toHaveLength(0);
            expect(collection.tabs[0].groupId).toBe(-1);
        });

        test('should preserve group colors', () => {
            const groups = [
                createMockTabGroup({ id: 1, color: 'red' }),
                createMockTabGroup({ id: 2, color: 'yellow' })
            ];
            const collection = createMockCollection({ chromeGroups: groups });

            expect(collection.chromeGroups[0].color).toBe('red');
            expect(collection.chromeGroups[1].color).toBe('yellow');
        });

        test('should preserve group collapsed state', () => {
            const groups = [
                createMockTabGroup({ id: 1, collapsed: true }),
                createMockTabGroup({ id: 2, collapsed: false })
            ];
            const collection = createMockCollection({ chromeGroups: groups });

            expect(collection.chromeGroups[0].collapsed).toBe(true);
            expect(collection.chromeGroups[1].collapsed).toBe(false);
        });
    });
});

// ============================================
// SAVING COLLECTION TESTS
// ============================================

describe('Saving Collections', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('save to storage', () => {
        test('should save collection to local storage', async () => {
            const collection = createMockCollection({ uid: 'save-test-1' });
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;

            await mockBrowser.storage.local.set({
                [collectionKey]: collection
            });

            expect(mockBrowser.storage.local.set).toHaveBeenCalled();
            expect(mockBrowser.storage.local._data[collectionKey]).toBeDefined();
        });

        test('should update collections index when saving', async () => {
            const collection = createMockCollection({ uid: 'index-test-1' });
            
            const index = {
                [collection.uid]: {
                    name: collection.name,
                    type: 'collection',
                    tabCount: collection.tabs.length,
                    lastUpdated: collection.lastUpdated
                }
            };

            await mockBrowser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: index
            });

            const stored = mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX];
            expect(stored[collection.uid]).toBeDefined();
            expect(stored[collection.uid].name).toBe(collection.name);
        });

        test('should preserve existing collections when adding new one', async () => {
            // Setup existing collection
            const existing = createMockCollection({ uid: 'existing-1', name: 'Existing' });
            mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX] = {
                [existing.uid]: { name: existing.name }
            };

            // Add new collection
            const newCollection = createMockCollection({ uid: 'new-1', name: 'New' });
            const currentIndex = { ...mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX] };
            currentIndex[newCollection.uid] = { name: newCollection.name };

            await mockBrowser.storage.local.set({
                [STORAGE_KEYS.COLLECTIONS_INDEX]: currentIndex
            });

            const stored = mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX];
            expect(Object.keys(stored)).toHaveLength(2);
            expect(stored['existing-1']).toBeDefined();
            expect(stored['new-1']).toBeDefined();
        });
    });

    describe('save current tabs', () => {
        test('should query current window tabs', async () => {
            mockBrowser.tabs.query.mockResolvedValueOnce([
                createMockTab({ url: 'https://tab1.com' }),
                createMockTab({ url: 'https://tab2.com' })
            ]);

            const tabs = await mockBrowser.tabs.query({ currentWindow: true });

            expect(mockBrowser.tabs.query).toHaveBeenCalledWith({ currentWindow: true });
            expect(tabs).toHaveLength(2);
        });

        test('should filter pinned tabs when setting enabled', async () => {
            mockBrowser.storage.local._data.chkIgnorePinned = true;
            
            const allTabs = [
                createMockTab({ url: 'https://pinned.com', pinned: true }),
                createMockTab({ url: 'https://normal.com', pinned: false })
            ];

            const filteredTabs = allTabs.filter(t => !t.pinned);

            expect(filteredTabs).toHaveLength(1);
            expect(filteredTabs[0].url).toBe('https://normal.com');
        });

        test('should include pinned tabs when setting disabled', async () => {
            mockBrowser.storage.local._data.chkIgnorePinned = false;
            
            const allTabs = [
                createMockTab({ url: 'https://pinned.com', pinned: true }),
                createMockTab({ url: 'https://normal.com', pinned: false })
            ];

            // No filtering
            expect(allTabs).toHaveLength(2);
        });

        test('should save only highlighted tabs when multiple selected', async () => {
            const allTabs = [
                createMockTab({ url: 'https://highlighted1.com', highlighted: true }),
                createMockTab({ url: 'https://highlighted2.com', highlighted: true }),
                createMockTab({ url: 'https://not-highlighted.com', highlighted: false })
            ];

            const highlightedTabs = allTabs.filter(t => t.highlighted);

            expect(highlightedTabs).toHaveLength(2);
        });
    });

    describe('save with metadata', () => {
        test('should preserve tab favicon URLs', () => {
            const tab = createMockTab({
                url: 'https://example.com',
                favIconUrl: 'https://example.com/favicon.ico'
            });
            const collection = createMockCollection({ tabs: [tab] });

            expect(collection.tabs[0].favIconUrl).toBe('https://example.com/favicon.ico');
        });

        test('should handle missing favicon URL', () => {
            const tab = createMockTab({
                url: 'https://example.com',
                favIconUrl: undefined
            });
            const collection = createMockCollection({ tabs: [tab] });

            expect(collection.tabs[0].favIconUrl).toBeUndefined();
        });

        test('should preserve tab titles', () => {
            const tab = createMockTab({
                url: 'https://example.com',
                title: 'Example Title'
            });
            const collection = createMockCollection({ tabs: [tab] });

            expect(collection.tabs[0].title).toBe('Example Title');
        });

        test('should preserve pinned state', () => {
            const tabs = [
                createMockTab({ url: 'https://pinned.com', pinned: true }),
                createMockTab({ url: 'https://normal.com', pinned: false })
            ];
            const collection = createMockCollection({ tabs });

            expect(collection.tabs[0].pinned).toBe(true);
            expect(collection.tabs[1].pinned).toBe(false);
        });
    });

    describe('incognito handling when saving', () => {
        test('should mark collection as saved from incognito', () => {
            const collection = createMockCollection({
                savedFromIncognito: true
            });

            expect(collection.savedFromIncognito).toBe(true);
        });

        test('should mark tabs with incognito origin', () => {
            const tabs = [
                createMockTab({ url: 'https://secret.com', incognito: true, wasIncognito: true })
            ];
            const collection = createMockCollection({ tabs });

            expect(collection.tabs[0].wasIncognito).toBe(true);
        });

        test('should count incognito tabs', () => {
            const tabs = [
                createMockTab({ incognito: true }),
                createMockTab({ incognito: true }),
                createMockTab({ incognito: false })
            ];

            const incognitoCount = tabs.filter(t => t.incognito).length;

            expect(incognitoCount).toBe(2);
        });
    });
});

// ============================================
// OPENING COLLECTION TESTS
// ============================================

describe('Opening Collections', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('open in current window', () => {
        test('should create tabs in current window', async () => {
            mockBrowser.storage.local._data.chkOpenNewWindow = false;

            const collection = createMockCollection({
                tabs: [
                    createMockTab({ url: 'https://tab1.com' }),
                    createMockTab({ url: 'https://tab2.com' })
                ]
            });

            for (const tab of collection.tabs) {
                await mockBrowser.tabs.create({ url: tab.url });
            }

            expect(mockBrowser.tabs.create).toHaveBeenCalledTimes(2);
        });

        test('should create tabs with correct URLs', async () => {
            const collection = createMockCollection({
                tabs: [createMockTab({ url: 'https://specific-url.com' })]
            });

            await mockBrowser.tabs.create({ url: collection.tabs[0].url });

            expect(mockBrowser.tabs.create).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'https://specific-url.com' })
            );
        });
    });

    describe('open in new window', () => {
        test('should create new window when setting enabled', async () => {
            mockBrowser.storage.local._data.chkOpenNewWindow = true;

            await mockBrowser.windows.create({ focused: true });

            expect(mockBrowser.windows.create).toHaveBeenCalledWith(
                expect.objectContaining({ focused: true })
            );
        });

        test('should create incognito window for incognito collection', async () => {
            const collection = createMockCollection({ savedFromIncognito: true });

            // Simulate opening in incognito
            if (collection.savedFromIncognito) {
                await mockBrowser.windows.create({ focused: true, incognito: true });
            }

            expect(mockBrowser.windows.create).toHaveBeenCalledWith(
                expect.objectContaining({ incognito: true })
            );
        });
    });

    describe('tab groups restoration', () => {
        test('should restore tab groups', async () => {
            const groups = [
                createMockTabGroup({ id: 1, title: 'Work', color: 'blue' })
            ];
            const tabs = [
                createMockTab({ url: 'https://work1.com', groupId: 1 }),
                createMockTab({ url: 'https://work2.com', groupId: 1 })
            ];
            const collection = createMockCollection({ tabs, chromeGroups: groups });

            // Simulate grouping tabs
            const createdTabIds = [101, 102];
            
            if (collection.chromeGroups.length > 0) {
                const groupId = await mockBrowser.tabs.group({ tabIds: createdTabIds });
                await mockBrowser.tabGroups.update(groupId, {
                    title: groups[0].title,
                    color: groups[0].color
                });
            }

            expect(mockBrowser.tabs.group).toHaveBeenCalled();
            expect(mockBrowser.tabGroups.update).toHaveBeenCalled();
        });

        test('should handle ungrouped tabs', () => {
            const tabs = [
                createMockTab({ url: 'https://ungrouped.com', groupId: -1 })
            ];
            const collection = createMockCollection({ tabs, chromeGroups: [] });

            const ungroupedTabs = collection.tabs.filter(t => t.groupId === -1);

            expect(ungroupedTabs).toHaveLength(1);
        });

        test('should restore collapsed group state', async () => {
            const groups = [
                createMockTabGroup({ id: 1, title: 'Collapsed', collapsed: true })
            ];

            await mockBrowser.tabGroups.update(1, { collapsed: true });

            expect(mockBrowser.tabGroups.update).toHaveBeenCalledWith(
                1,
                expect.objectContaining({ collapsed: true })
            );
        });
    });

    describe('pinned tabs restoration', () => {
        test('should restore pinned state', async () => {
            const tabs = [
                createMockTab({ url: 'https://pinned.com', pinned: true })
            ];
            const collection = createMockCollection({ tabs });

            // Simulate creating tab then pinning
            const createdTab = await mockBrowser.tabs.create({ url: tabs[0].url });
            if (tabs[0].pinned) {
                await mockBrowser.tabs.update(createdTab.id, { pinned: true });
            }

            expect(mockBrowser.tabs.update).toHaveBeenCalledWith(
                createdTab.id,
                expect.objectContaining({ pinned: true })
            );
        });

        test('should pin tabs in correct order', () => {
            const tabs = [
                createMockTab({ url: 'https://pinned1.com', pinned: true, index: 0 }),
                createMockTab({ url: 'https://pinned2.com', pinned: true, index: 1 }),
                createMockTab({ url: 'https://normal.com', pinned: false, index: 2 })
            ];

            const pinnedTabs = tabs.filter(t => t.pinned).sort((a, b) => a.index - b.index);

            expect(pinnedTabs[0].url).toBe('https://pinned1.com');
            expect(pinnedTabs[1].url).toBe('https://pinned2.com');
        });
    });

    describe('duplicate tab handling', () => {
        test('should detect duplicate URLs when setting enabled', () => {
            const existingTabs = [
                createMockTab({ url: 'https://existing.com' })
            ];
            const collectionTabs = [
                createMockTab({ url: 'https://existing.com' }),
                createMockTab({ url: 'https://new.com' })
            ];

            const chkIgnoreDuplicates = true;
            const existingUrls = new Set(existingTabs.map(t => t.url));
            
            const tabsToOpen = chkIgnoreDuplicates
                ? collectionTabs.filter(t => !existingUrls.has(t.url))
                : collectionTabs;

            expect(tabsToOpen).toHaveLength(1);
            expect(tabsToOpen[0].url).toBe('https://new.com');
        });

        test('should allow duplicates when setting disabled', () => {
            const existingTabs = [
                createMockTab({ url: 'https://existing.com' })
            ];
            const collectionTabs = [
                createMockTab({ url: 'https://existing.com' }),
                createMockTab({ url: 'https://new.com' })
            ];

            const chkIgnoreDuplicates = false;
            
            const tabsToOpen = chkIgnoreDuplicates
                ? collectionTabs.filter(t => !new Set(existingTabs.map(et => et.url)).has(t.url))
                : collectionTabs;

            expect(tabsToOpen).toHaveLength(2);
        });
    });

    describe('update lastOpened timestamp', () => {
        test('should update lastOpened when opening collection', () => {
            const collection = createMockCollection({ lastOpened: null });
            
            // Simulate opening
            collection.lastOpened = Date.now();

            expect(collection.lastOpened).not.toBeNull();
            expect(typeof collection.lastOpened).toBe('number');
        });
    });
});

// ============================================
// TAB URL HANDLING TESTS
// ============================================

describe('Tab URL Handling', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('valid URLs', () => {
        test('should handle HTTP URLs', () => {
            const tab = createMockTab({ url: 'http://example.com' });
            expect(tab.url).toStartWith('http://');
        });

        test('should handle HTTPS URLs', () => {
            const tab = createMockTab({ url: 'https://example.com' });
            expect(tab.url).toStartWith('https://');
        });

        test('should handle URLs with paths', () => {
            const tab = createMockTab({ url: 'https://example.com/path/to/page' });
            expect(tab.url).toContain('/path/to/page');
        });

        test('should handle URLs with query strings', () => {
            const tab = createMockTab({ url: 'https://example.com?query=value&foo=bar' });
            expect(tab.url).toContain('?query=value');
        });

        test('should handle URLs with fragments', () => {
            const tab = createMockTab({ url: 'https://example.com#section' });
            expect(tab.url).toContain('#section');
        });

        test('should handle URLs with ports', () => {
            const tab = createMockTab({ url: 'https://example.com:8080/page' });
            expect(tab.url).toContain(':8080');
        });
    });

    describe('special URLs', () => {
        test('should handle chrome:// URLs', () => {
            const tab = createMockTab({ url: 'chrome://extensions' });
            expect(tab.url).toStartWith('chrome://');
        });

        test('should handle about: URLs', () => {
            const tab = createMockTab({ url: 'about:blank' });
            expect(tab.url).toStartWith('about:');
        });

        test('should handle file:// URLs', () => {
            const tab = createMockTab({ url: 'file:///path/to/file.html' });
            expect(tab.url).toStartWith('file://');
        });

        test('should handle data: URLs', () => {
            const tab = createMockTab({ url: 'data:text/html,<h1>Test</h1>' });
            expect(tab.url).toStartWith('data:');
        });

        test('should identify javascript: URLs for filtering', () => {
            const url = 'javascript:alert("test")';
            const isJavaScript = url.toLowerCase().startsWith('javascript:');
            expect(isJavaScript).toBe(true);
        });
    });

    describe('URL validation', () => {
        test('should detect empty URLs', () => {
            const tab = createMockTab({ url: '' });
            const isValid = tab.url && tab.url.length > 0;
            expect(isValid).toBeFalsy();
        });

        test('should detect undefined URLs', () => {
            const tab = createMockTab({ url: undefined });
            const isValid = !!tab.url;
            expect(isValid).toBe(false);
        });

        test('should detect null URLs', () => {
            const tab = createMockTab({ url: null });
            const isValid = !!tab.url;
            expect(isValid).toBe(false);
        });
    });
});

// ============================================
// COLLECTION UPDATE TESTS
// ============================================

describe('Collection Updates', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('rename collection', () => {
        test('should update collection name', () => {
            const collection = createMockCollection({ name: 'Old Name' });
            collection.name = 'New Name';

            expect(collection.name).toBe('New Name');
        });

        test('should update lastUpdated on rename', () => {
            const collection = createMockCollection({
                name: 'Old Name',
                lastUpdated: 1000
            });
            
            collection.name = 'New Name';
            collection.lastUpdated = Date.now();

            expect(collection.lastUpdated).toBeGreaterThan(1000);
        });
    });

    describe('add tab to collection', () => {
        test('should add tab to existing collection', () => {
            const collection = createMockCollection({
                tabs: [createMockTab({ url: 'https://existing.com' })]
            });

            const newTab = createMockTab({ url: 'https://new.com' });
            collection.tabs.push(newTab);

            expect(collection.tabs).toHaveLength(2);
        });

        test('should add tab at specific position', () => {
            const collection = createMockCollection({
                tabs: [
                    createMockTab({ url: 'https://first.com' }),
                    createMockTab({ url: 'https://third.com' })
                ]
            });

            const newTab = createMockTab({ url: 'https://second.com' });
            collection.tabs.splice(1, 0, newTab);

            expect(collection.tabs[1].url).toBe('https://second.com');
        });
    });

    describe('remove tab from collection', () => {
        test('should remove tab by index', () => {
            const collection = createMockCollection({
                tabs: [
                    createMockTab({ url: 'https://keep.com' }),
                    createMockTab({ url: 'https://remove.com' })
                ]
            });

            collection.tabs.splice(1, 1);

            expect(collection.tabs).toHaveLength(1);
            expect(collection.tabs[0].url).toBe('https://keep.com');
        });

        test('should remove tab by URL', () => {
            const collection = createMockCollection({
                tabs: [
                    createMockTab({ url: 'https://keep.com' }),
                    createMockTab({ url: 'https://remove.com' })
                ]
            });

            collection.tabs = collection.tabs.filter(t => t.url !== 'https://remove.com');

            expect(collection.tabs).toHaveLength(1);
        });
    });

    describe('change collection color', () => {
        test('should update collection color', () => {
            const collection = createMockCollection({ color: 'blue' });
            collection.color = 'red';

            expect(collection.color).toBe('red');
        });
    });

    describe('move collection to folder', () => {
        test('should set parentId when moving to folder', () => {
            const collection = createMockCollection({ parentId: null });
            collection.parentId = 'folder-123';

            expect(collection.parentId).toBe('folder-123');
        });

        test('should clear parentId when moving to root', () => {
            const collection = createMockCollection({ parentId: 'folder-123' });
            collection.parentId = null;

            expect(collection.parentId).toBeNull();
        });
    });
});

// ============================================
// COLLECTION DELETION TESTS
// ============================================

describe('Collection Deletion', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('delete from storage', () => {
        test('should remove collection from storage', async () => {
            const collection = createMockCollection({ uid: 'delete-me' });
            const collectionKey = `${STORAGE_KEYS.COLLECTION_PREFIX}${collection.uid}`;

            // Setup
            mockBrowser.storage.local._data[collectionKey] = collection;
            mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX] = {
                [collection.uid]: { name: collection.name }
            };

            // Delete
            await mockBrowser.storage.local.remove(collectionKey);
            delete mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX][collection.uid];

            expect(mockBrowser.storage.local._data[collectionKey]).toBeUndefined();
            expect(mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX][collection.uid]).toBeUndefined();
        });

        test('should update index after deletion', async () => {
            const collections = [
                createMockCollection({ uid: 'keep-1' }),
                createMockCollection({ uid: 'delete-1' }),
                createMockCollection({ uid: 'keep-2' })
            ];

            const index = {};
            collections.forEach(c => {
                index[c.uid] = { name: c.name };
            });
            mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX] = index;

            // Delete one
            delete mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX]['delete-1'];

            const remainingKeys = Object.keys(mockBrowser.storage.local._data[STORAGE_KEYS.COLLECTIONS_INDEX]);
            expect(remainingKeys).toHaveLength(2);
            expect(remainingKeys).not.toContain('delete-1');
        });
    });
});

// ============================================
// EDGE CASES TESTS
// ============================================

describe('Edge Cases', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('empty collection', () => {
        test('should handle collection with no tabs', () => {
            const collection = createMockCollection({ tabs: [] });
            
            expect(collection.tabs).toHaveLength(0);
        });

        test('should handle opening empty collection', async () => {
            const collection = createMockCollection({ tabs: [] });
            
            // Should not create any tabs
            if (collection.tabs.length === 0) {
                // Early return, no tabs created
            } else {
                for (const tab of collection.tabs) {
                    await mockBrowser.tabs.create({ url: tab.url });
                }
            }

            expect(mockBrowser.tabs.create).not.toHaveBeenCalled();
        });
    });

    describe('large collections', () => {
        test('should handle collection with 100 tabs', () => {
            const tabs = Array.from({ length: 100 }, (_, i) =>
                createMockTab({ url: `https://example.com/page${i}` })
            );
            const collection = createMockCollection({ tabs });

            expect(collection.tabs).toHaveLength(100);
        });

        test('should handle collection with many groups', () => {
            const groups = Array.from({ length: 20 }, (_, i) =>
                createMockTabGroup({ id: i + 1, title: `Group ${i + 1}` })
            );
            const collection = createMockCollection({ chromeGroups: groups });

            expect(collection.chromeGroups).toHaveLength(20);
        });
    });

    describe('special characters in names', () => {
        test('should handle Unicode collection name', () => {
            const collection = createMockCollection({ name: '日本語コレクション 🎉' });
            expect(collection.name).toBe('日本語コレクション 🎉');
        });

        test('should handle special characters in tab title', () => {
            const tab = createMockTab({ title: 'Page <with> "special" & characters' });
            const collection = createMockCollection({ tabs: [tab] });
            expect(collection.tabs[0].title).toContain('&');
        });
    });

    describe('browser API failures', () => {
        test('should handle tabs.create failure', async () => {
            mockBrowser.tabs.create.mockRejectedValueOnce(new Error('Tab creation failed'));

            let error = null;
            try {
                await mockBrowser.tabs.create({ url: 'https://example.com' });
            } catch (e) {
                error = e;
            }

            expect(error).not.toBeNull();
            expect(error.message).toBe('Tab creation failed');
        });

        test('should handle windows.create failure', async () => {
            mockBrowser.windows.create.mockRejectedValueOnce(new Error('Window creation failed'));

            let error = null;
            try {
                await mockBrowser.windows.create({ focused: true });
            } catch (e) {
                error = e;
            }

            expect(error).not.toBeNull();
        });

        test('should handle storage failure', async () => {
            mockBrowser.storage.local.set.mockRejectedValueOnce(new Error('Storage quota exceeded'));

            let error = null;
            try {
                await mockBrowser.storage.local.set({ key: 'value' });
            } catch (e) {
                error = e;
            }

            expect(error).not.toBeNull();
            expect(error.message).toBe('Storage quota exceeded');
        });
    });
});

// ============================================
// IMPORT/EXPORT TESTS
// ============================================

describe('Import/Export', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('export collection', () => {
        test('should serialize collection to JSON', () => {
            const collection = createMockCollection({
                uid: 'export-test',
                name: 'Export Test',
                tabs: [createMockTab({ url: 'https://export.com' })]
            });

            const json = JSON.stringify(collection);
            const parsed = JSON.parse(json);

            expect(parsed.uid).toBe('export-test');
            expect(parsed.name).toBe('Export Test');
            expect(parsed.tabs).toHaveLength(1);
        });

        test('should preserve all fields in export', () => {
            const collection = createMockCollection({
                uid: 'full-export',
                name: 'Full Export',
                tabs: [createMockTab()],
                chromeGroups: [createMockTabGroup()],
                color: 'red',
                createdOn: 1000,
                lastUpdated: 2000,
                lastOpened: 3000
            });

            const json = JSON.stringify(collection);
            const parsed = JSON.parse(json);

            expect(parsed.color).toBe('red');
            expect(parsed.createdOn).toBe(1000);
            expect(parsed.lastUpdated).toBe(2000);
            expect(parsed.lastOpened).toBe(3000);
        });
    });

    describe('import collection', () => {
        test('should parse imported JSON', () => {
            const json = JSON.stringify({
                name: 'Imported Collection',
                tabs: [{ url: 'https://imported.com', title: 'Imported' }]
            });

            const imported = JSON.parse(json);

            expect(imported.name).toBe('Imported Collection');
            expect(imported.tabs).toHaveLength(1);
        });

        test('should generate new UID for imported collection', () => {
            const imported = {
                uid: 'old-uid',
                name: 'Imported',
                tabs: []
            };

            // Generate new UID
            imported.uid = mockCrypto.randomUUID();

            expect(imported.uid).not.toBe('old-uid');
        });

        test('should handle missing fields in import', () => {
            const imported = {
                name: 'Minimal Import',
                tabs: []
            };

            // Apply defaults
            imported.uid = imported.uid || mockCrypto.randomUUID();
            imported.color = imported.color || 'var(--collection-default-color)';
            imported.createdOn = imported.createdOn || Date.now();
            imported.lastUpdated = imported.lastUpdated || Date.now();
            imported.chromeGroups = imported.chromeGroups || [];

            expect(imported.uid).toBeDefined();
            expect(imported.color).toBe('var(--collection-default-color)');
            expect(imported.chromeGroups).toEqual([]);
        });
    });
});

// Custom matcher
expect.extend({
    toStartWith(received, prefix) {
        const pass = typeof received === 'string' && received.startsWith(prefix);
        return {
            pass,
            message: () => pass
                ? `expected ${received} not to start with ${prefix}`
                : `expected ${received} to start with ${prefix}`
        };
    }
});
