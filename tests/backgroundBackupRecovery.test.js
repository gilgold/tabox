const { createBrowserHarness } = require('./helpers/browserHarness');

describe('background backup recovery handlers', () => {
    let browser;
    let collectionsState;
    let foldersState;

    beforeEach(() => {
        jest.resetModules();

        collectionsState = [];
        foldersState = [];
        browser = createBrowserHarness({
            localData: {
                autoBackups: [
                    {
                        timestamp: 1710000000000,
                        tabsArray: [
                            { uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [], chromeGroups: [] },
                        ],
                        foldersArray: [
                            { uid: 'folder-1', name: 'Team', color: 'red', collapsed: false },
                        ],
                    },
                ],
                preSyncBackups: [
                    {
                        timestamp: 1710100000000,
                        label: 'Before upload',
                        tabsArray: [
                            {
                                uid: 'collection-2',
                                name: 'Metadata Only',
                                tabCount: 2,
                                sampleTabs: [{ title: 'Example', url: 'https://example.com' }],
                            },
                        ],
                    },
                ],
                backup: {
                    version: '4.0.0',
                    timestamp: 1710200000000,
                    tabsArray: [
                        { uid: 'collection-3', name: 'Version Backup', parentId: null, tabs: [], chromeGroups: [] },
                    ],
                    foldersArray: [],
                },
            },
        });

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        global.loadCollectionsIndexBG = jest.fn(async () => ({}));
        global.loadAllCollectionsBG = jest.fn(async () => collectionsState);
        global.loadAllFoldersBG = jest.fn(async () => foldersState);
        global.loadSingleCollectionBG = jest.fn(async (uid) => collectionsState.find((collection) => collection.uid === uid) || null);
        global.loadSingleFolderBG = jest.fn(async (uid) => foldersState.find((folder) => folder.uid === uid) || null);
        global.saveSingleCollectionBG = jest.fn(async (collection) => {
            const index = collectionsState.findIndex((entry) => entry.uid === collection.uid);
            if (index > -1) {
                collectionsState[index] = { ...collectionsState[index], ...collection };
            } else {
                collectionsState.push({ ...collection });
            }
            return true;
        });
        global.saveSingleFolderBG = jest.fn(async (folder) => {
            const index = foldersState.findIndex((entry) => entry.uid === folder.uid);
            if (index > -1) {
                foldersState[index] = { ...foldersState[index], ...folder };
            } else {
                foldersState.push({ ...folder });
            }
            return true;
        });
        global.forceLegacyStorageSync = jest.fn(async () => {});
        global.updateAllCollectionsBG = jest.fn(async (collections) => {
            for (const collection of collections) {
                const index = collectionsState.findIndex((entry) => entry.uid === collection.uid);
                if (index > -1) {
                    collectionsState[index] = { ...collectionsState[index], ...collection };
                } else {
                    collectionsState.push({ ...collection });
                }
            }
            return true;
        });
        global.generateUid = jest.fn(() => `generated-${Math.random().toString(36).slice(2, 8)}`);
        global.applyUid = jest.fn((value) => value);
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
        delete global.loadCollectionsIndexBG;
        delete global.loadAllCollectionsBG;
        delete global.loadAllFoldersBG;
        delete global.loadSingleCollectionBG;
        delete global.loadSingleFolderBG;
        delete global.saveSingleCollectionBG;
        delete global.saveSingleFolderBG;
        delete global.forceLegacyStorageSync;
        delete global.updateAllCollectionsBG;
        delete global.generateUid;
        delete global.applyUid;
    });

    test('returns grouped normalized backup descriptors with capability flags', async () => {
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({ type: 'getBackupOptions' });

        expect(result.groups).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: 'auto',
                items: [
                    expect.objectContaining({
                        id: 'auto:0',
                        source: 'auto',
                        canPreview: true,
                        canSelectiveRestore: true,
                        canOverwrite: true,
                        folderCount: 1,
                    }),
                ],
            }),
            expect.objectContaining({
                key: 'preSync',
                items: [
                    expect.objectContaining({
                        id: 'preSync:0',
                        source: 'preSync',
                        canPreview: true,
                        canSelectiveRestore: false,
                        canOverwrite: false,
                        previewType: 'metadata_only',
                    }),
                ],
            }),
        ]));
    });

    test('returns preview-ready payloads for full backups and limited metadata for pre-sync backups', async () => {
        require('../chrome/background.js');

        const fullPreview = await browser.runtime.sendMessage({ type: 'getBackupPreview', backupId: 'auto:0' });
        expect(fullPreview).toEqual({
            kind: 'full_export',
            payload: {
                type: 'full_export',
                folders: [{ uid: 'folder-1', name: 'Team', color: 'red', collapsed: false }],
                collections: [{ uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [], chromeGroups: [] }],
            },
        });

        const metadataPreview = await browser.runtime.sendMessage({ type: 'getBackupPreview', backupId: 'preSync:0' });
        expect(metadataPreview).toEqual(expect.objectContaining({
            kind: 'metadata_only',
            items: [
                expect.objectContaining({
                    uid: 'collection-2',
                    name: 'Metadata Only',
                    tabCount: 2,
                }),
            ],
        }));
    });

    test('uses current local folder names when older backups do not include foldersArray', async () => {
        browser.storage.local._data.autoBackups = [
            {
                timestamp: 1710000000000,
                tabsArray: [
                    { uid: 'collection-1', name: 'Alpha', parentId: 'folder-legacy', tabs: [], chromeGroups: [] },
                ],
            },
        ];

        foldersState = [
            { uid: 'folder-legacy', name: 'Design Inbox', color: 'purple', collapsed: false },
        ];

        require('../chrome/background.js');

        const fullPreview = await browser.runtime.sendMessage({ type: 'getBackupPreview', backupId: 'auto:0' });

        expect(fullPreview).toEqual({
            kind: 'full_export',
            payload: {
                type: 'full_export',
                folders: [{ uid: 'folder-legacy', name: 'Design Inbox', color: 'purple', collapsed: false }],
                collections: [{ uid: 'collection-1', name: 'Alpha', parentId: 'folder-legacy', tabs: [], chromeGroups: [] }],
            },
        });
    });

    test('routes import restores through the existing import flow', async () => {
        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({
            type: 'restoreBackupSelection',
            backupId: 'auto:0',
            mode: 'import',
            payload: {
                type: 'full_export',
                folders: [{ uid: 'folder-1', name: 'Team' }],
                collections: [{ uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [], chromeGroups: [] }],
            },
        });

        expect(result).toEqual(expect.objectContaining({
            success: true,
            collectionsImported: 1,
            foldersImported: 1,
        }));
    });

    test('recoverFromBackup writes restored collections into indexed storage, not just legacy tabsArray', async () => {
        // Existing user already has a populated indexed store (non-empty index).
        collectionsState = [
            { uid: 'current-1', name: 'Current Collection', parentId: null, tabs: [], chromeGroups: [] },
        ];

        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({
            type: 'recoverFromBackup',
            backupType: 'auto',
            backupIndex: 0,
        });

        expect(result).toBe(true);
        // The backup's collection must land in the indexed storage that loadAllCollections() reads,
        // otherwise the popup reload returns stale data and nothing visibly restores.
        expect(collectionsState).toEqual(expect.arrayContaining([
            expect.objectContaining({ uid: 'collection-1', name: 'Alpha' }),
        ]));
    });

    test('overwrites only the selected items, creates an emergency auto backup, and normalizes missing folder references', async () => {
        collectionsState = [
            { uid: 'collection-1', name: 'Old Alpha', parentId: 'folder-local', tabs: [{ title: 'Old', url: 'https://old.example.com' }], chromeGroups: [] },
            { uid: 'collection-keep', name: 'Keep Me', parentId: null, tabs: [], chromeGroups: [] },
        ];
        foldersState = [
            { uid: 'folder-local', name: 'Local Folder', color: 'blue', collapsed: false },
        ];

        require('../chrome/background.js');

        const result = await browser.runtime.sendMessage({
            type: 'restoreBackupSelection',
            backupId: 'auto:0',
            mode: 'overwrite',
            payload: {
                type: 'full_export',
                folders: [],
                collections: [
                    { uid: 'collection-1', name: 'Recovered Alpha', parentId: 'folder-missing', tabs: [], chromeGroups: [] },
                ],
            },
        });

        expect(result).toEqual(expect.objectContaining({
            success: true,
            overwrittenCollections: 1,
        }));
        expect(collectionsState).toEqual(expect.arrayContaining([
            expect.objectContaining({
                uid: 'collection-1',
                name: 'Recovered Alpha',
                parentId: null,
            }),
            expect.objectContaining({
                uid: 'collection-keep',
                name: 'Keep Me',
            }),
        ]));
        expect(browser.storage.local._data.autoBackups[0]).toEqual(expect.objectContaining({
            reason: 'Before selective overwrite restore',
            tabsArray: expect.arrayContaining([
                expect.objectContaining({ uid: 'collection-1', name: 'Old Alpha' }),
            ]),
            foldersArray: expect.arrayContaining([
                expect.objectContaining({ uid: 'folder-local' }),
            ]),
        }));
    });
});
