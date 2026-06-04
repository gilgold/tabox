const {
    normalizeSyncSnapshot,
    mergeSyncSnapshots
} = require('../chrome/sync-merge.js');

describe('sync merge module', () => {
    test('normalizes missing arrays and sync metadata', () => {
        expect(normalizeSyncSnapshot({})).toEqual({
            timestamp: 0,
            tabsArray: [],
            deletedCollections: [],
            deletedFolders: [],
            foldersArray: [],
            syncVersion: '4.0',
            storageVersion: 3,
            extensionVersion: '4.0',
            isIncrementalSync: false
        });
    });

    test('normalizes an omitted snapshot input', () => {
        expect(normalizeSyncSnapshot()).toEqual({
            timestamp: 0,
            tabsArray: [],
            deletedCollections: [],
            deletedFolders: [],
            foldersArray: [],
            syncVersion: '4.0',
            storageVersion: 3,
            extensionVersion: '4.0',
            isIncrementalSync: false
        });
    });

    test('normalizes collection and folder defaults when optional fields are missing', () => {
        expect(normalizeSyncSnapshot({
            timestamp: 10,
            tabsArray: [
                { uid: 'collection-a', tabs: null }
            ],
            deletedCollections: [
                { uid: 'deleted-a' }
            ],
            deletedFolders: [
                { uid: 'deleted-folder-a' }
            ],
            foldersArray: [
                { uid: 'folder-a' }
            ]
        }, 9000)).toEqual({
            timestamp: 10,
            tabsArray: [
                {
                    uid: 'collection-a',
                    name: 'Untitled Collection',
                    tabs: [],
                    chromeGroups: [],
                    createdOn: 9000,
                    lastUpdated: 9000,
                    lastOpened: null,
                    parentId: null,
                    order: 0,
                    type: 'collection'
                }
            ],
            deletedCollections: [
                {
                    uid: 'deleted-a',
                    lastUpdated: 0
                }
            ],
            deletedFolders: [
                {
                    uid: 'deleted-folder-a',
                    lastUpdated: 0
                }
            ],
            foldersArray: [
                {
                    uid: 'folder-a',
                    name: 'Untitled Folder',
                    type: 'folder',
                    color: 'var(--folder-default-color)',
                    collapsed: false,
                    createdOn: 9000,
                    lastUpdated: 9000,
                    order: 0
                }
            ],
            syncVersion: '4.0',
            storageVersion: 3,
            extensionVersion: '4.0',
            isIncrementalSync: false
        });
    });

    test('keeps disjoint collection edits from both devices during merge', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                tabsArray: [
                    { uid: 'collection-local', name: 'Local Only', tabs: [], createdOn: 10, lastUpdated: 400 }
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 1100,
                tabsArray: [
                    { uid: 'collection-remote', name: 'Remote Only', tabs: [], createdOn: 20, lastUpdated: 500 }
                ],
                foldersArray: []
            }
        });

        expect(merged.tabsArray.map((collection) => collection.uid).sort()).toEqual([
            'collection-local',
            'collection-remote'
        ]);
    });

    test('keeps a newer local deletion from resurrecting an older remote collection during conflict merge', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1100,
                tabsArray: [],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 1050,
                tabsArray: [
                    {
                        uid: 'collection-deleted-locally',
                        name: 'Should Stay Deleted',
                        tabs: [],
                        createdOn: 10,
                        lastUpdated: 900
                    }
                ],
                foldersArray: []
            }
        });

        expect(merged.tabsArray).toEqual([]);
    });

    test('applies a newer remote deletion instead of keeping a stale local collection during conflict merge', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1050,
                tabsArray: [
                    {
                        uid: 'collection-deleted-remotely',
                        name: 'Should Be Deleted',
                        tabs: [],
                        createdOn: 10,
                        lastUpdated: 900
                    }
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 1100,
                tabsArray: [],
                deletedCollections: [
                    {
                        uid: 'collection-deleted-remotely',
                        lastUpdated: 1100
                    }
                ],
                foldersArray: []
            }
        });

        expect(merged.tabsArray).toEqual([]);
        expect(merged.deletedCollections).toEqual([
            {
                uid: 'collection-deleted-remotely',
                lastUpdated: 1100
            }
        ]);
    });

    test('applies a folder deletion tombstone so a folder deleted on one device is removed (not resurrected) on merge', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1050,
                tabsArray: [],
                foldersArray: [
                    {
                        uid: 'folder-deleted-remotely',
                        name: 'Should Be Deleted',
                        createdOn: 10,
                        lastUpdated: 900,
                        order: 0
                    }
                ]
            },
            remoteSnapshot: {
                timestamp: 1100,
                tabsArray: [],
                foldersArray: [],
                deletedFolders: [
                    { uid: 'folder-deleted-remotely', lastUpdated: 1100 }
                ]
            }
        });

        expect(merged.foldersArray).toEqual([]);
        expect(merged.deletedFolders).toEqual([
            { uid: 'folder-deleted-remotely', lastUpdated: 1100 }
        ]);
    });

    test('keeps a folder edited after its tombstone (re-created folder survives deletion tombstone)', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1200,
                tabsArray: [],
                foldersArray: [
                    {
                        uid: 'folder-recreated',
                        name: 'Recreated',
                        createdOn: 10,
                        lastUpdated: 1300,
                        order: 0
                    }
                ]
            },
            remoteSnapshot: {
                timestamp: 1100,
                tabsArray: [],
                foldersArray: [],
                deletedFolders: [
                    { uid: 'folder-recreated', lastUpdated: 1100 }
                ]
            }
        });

        expect(merged.foldersArray).toEqual([
            expect.objectContaining({ uid: 'folder-recreated', name: 'Recreated' })
        ]);
        // The tombstone is older than the surviving folder, so it is dropped.
        expect(merged.deletedFolders).toEqual([]);
    });

    test('keeps the newest folder tombstone for the same uid and sorts deterministically', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                tabsArray: [],
                foldersArray: [],
                deletedFolders: [
                    { uid: 'folder-late', lastUpdated: 700 },
                    { uid: 'folder-shared', lastUpdated: 900 }
                ]
            },
            remoteSnapshot: {
                timestamp: 1000,
                tabsArray: [],
                foldersArray: [],
                deletedFolders: [
                    { uid: 'folder-early', lastUpdated: 400 },
                    { uid: 'folder-shared', lastUpdated: 600 }
                ]
            }
        });

        expect(merged.deletedFolders).toEqual([
            { uid: 'folder-early', lastUpdated: 400 },
            { uid: 'folder-late', lastUpdated: 700 },
            { uid: 'folder-shared', lastUpdated: 900 }
        ]);
    });

    test('keeps a remote-only collection when the local snapshot is newer but the remote entity was updated after it', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1100,
                tabsArray: [],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 1050,
                tabsArray: [
                    {
                        uid: 'collection-remote-newer',
                        name: 'Remote Newer Edit',
                        tabs: [],
                        createdOn: 10,
                        lastUpdated: 1200
                    }
                ],
                foldersArray: []
            }
        });

        expect(merged.tabsArray).toEqual([
            expect.objectContaining({
                uid: 'collection-remote-newer',
                name: 'Remote Newer Edit'
            })
        ]);
    });

    test('drops tombstones older than a surviving entity and sorts remaining tombstones deterministically', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                tabsArray: [
                    {
                        uid: 'collection-survives',
                        name: 'Survives',
                        tabs: [],
                        createdOn: 10,
                        lastUpdated: 1200,
                        order: 0
                    }
                ],
                deletedCollections: [
                    { uid: 'collection-b', lastUpdated: 500 },
                    { uid: 'collection-survives', lastUpdated: 1100 },
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 1000,
                tabsArray: [],
                deletedCollections: [
                    { uid: 'collection-a', lastUpdated: 500 },
                ],
                foldersArray: []
            }
        });

        expect(merged.tabsArray).toEqual([
            expect.objectContaining({
                uid: 'collection-survives'
            })
        ]);
        expect(merged.deletedCollections).toEqual([
            { uid: 'collection-a', lastUpdated: 500 },
            { uid: 'collection-b', lastUpdated: 500 },
        ]);
    });

    test('keeps the newest duplicate tombstone for the same uid', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                tabsArray: [],
                deletedCollections: [
                    { uid: 'collection-shared-delete', lastUpdated: 900 },
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 1000,
                tabsArray: [],
                deletedCollections: [
                    { uid: 'collection-shared-delete', lastUpdated: 700 },
                ],
                foldersArray: []
            }
        });

        expect(merged.deletedCollections).toEqual([
            { uid: 'collection-shared-delete', lastUpdated: 900 },
        ]);
    });

    test('sorts merged tombstones by lastUpdated before uid when timestamps differ', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                tabsArray: [],
                deletedCollections: [
                    { uid: 'collection-late', lastUpdated: 700 },
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 1000,
                tabsArray: [],
                deletedCollections: [
                    { uid: 'collection-early', lastUpdated: 400 },
                ],
                foldersArray: []
            }
        });

        expect(merged.deletedCollections).toEqual([
            { uid: 'collection-early', lastUpdated: 400 },
            { uid: 'collection-late', lastUpdated: 700 },
        ]);
    });

    test('uses the newer lastUpdated for same-uid conflicts and normalizes orphaned parentId values', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                tabsArray: [
                    {
                        uid: 'collection-shared',
                        name: 'Local Version',
                        tabs: [],
                        createdOn: 10,
                        lastUpdated: 400,
                        parentId: 'folder-missing'
                    }
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 1100,
                tabsArray: [
                    {
                        uid: 'collection-shared',
                        name: 'Remote Version',
                        tabs: [],
                        createdOn: 10,
                        lastUpdated: 400,
                        parentId: 'folder-remote'
                    }
                ],
                foldersArray: []
            }
        });

        expect(merged.tabsArray).toEqual([
            expect.objectContaining({
                uid: 'collection-shared',
                name: 'Remote Version',
                parentId: null
            })
        ]);
    });

    test('keeps the local entity when the remote version is older and sorts equal-order entities by uid', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                tabsArray: [
                    { uid: 'b-collection', name: 'B', tabs: [], createdOn: 10, lastUpdated: 500, order: 0 },
                    { uid: 'a-collection', name: 'A', tabs: [], createdOn: 10, lastUpdated: 600, order: 0 },
                    { uid: 'shared', name: 'Local Wins', tabs: [], createdOn: 10, lastUpdated: 900, order: 1 }
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 900,
                tabsArray: [
                    { uid: 'shared', name: 'Remote Loses', tabs: [], createdOn: 10, lastUpdated: 800, order: 1 }
                ],
                foldersArray: []
            }
        });

        expect(merged.tabsArray.map((collection) => collection.uid)).toEqual([
            'a-collection',
            'b-collection',
            'shared'
        ]);
        expect(merged.tabsArray.find((collection) => collection.uid === 'shared')).toEqual(
            expect.objectContaining({
                name: 'Local Wins'
            })
        );
    });

    test('uses normalized remote metadata when the remote snapshot omits explicit version fields', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                syncVersion: '4.1',
                storageVersion: 4,
                extensionVersion: '4.2',
                tabsArray: [
                    { uid: 'collection-a', name: 'A', tabs: [], createdOn: 10, lastUpdated: 20, order: 0 }
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 900,
                tabsArray: [],
                foldersArray: []
            }
        });

        expect(merged.syncVersion).toBe('4.0');
        expect(merged.storageVersion).toBe(3);
        expect(merged.extensionVersion).toBe('4.0');
    });

    test('uses default version metadata when neither side provides it', () => {
        const merged = mergeSyncSnapshots({
            localSnapshot: {
                timestamp: 1000,
                syncVersion: '',
                storageVersion: NaN,
                extensionVersion: '',
                tabsArray: [
                    { uid: 'collection-b', name: 'B', tabs: [], createdOn: 10, lastUpdated: 20, order: 0 }
                ],
                foldersArray: []
            },
            remoteSnapshot: {
                timestamp: 900,
                syncVersion: '',
                storageVersion: NaN,
                extensionVersion: '',
                tabsArray: [],
                foldersArray: []
            }
        });

        expect(merged.syncVersion).toBe('4.0');
        expect(merged.storageVersion).toBe(3);
        expect(merged.extensionVersion).toBe('4.0');
    });
});
