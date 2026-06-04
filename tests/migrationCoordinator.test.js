jest.mock('../app/utils/storageUtils.js', () => ({
    getAllStorageData: jest.fn(),
    safeStorageSet: jest.fn(),
    safeStorageGet: jest.fn(),
    safeStorageRemove: jest.fn(),
    atomicStorageTransaction: jest.fn(),
    getStorageStats: jest.fn(),
}));

jest.mock('../app/utils/dataValidation.js', () => ({
    detectAndValidateFormat: jest.fn(),
    isDataSafe: jest.fn(),
}));

jest.mock('../app/utils/migrationSupport40.js', () => ({
    assessMigrationSupport40: jest.fn(),
}));

jest.mock('../app/utils/backupUtils.js', () => ({
    createMigrationBackup: jest.fn(),
    createRollbackChain: jest.fn(),
    addToRollbackChain: jest.fn(),
    executeRollback: jest.fn(),
    cleanupOldBackups: jest.fn(),
}));

jest.mock('../app/utils/colorMigration.js', () => ({
    COLOR_PALETTE: {
        blue: '#4facfe',
        red: '#ef4444',
    },
    migrateAllCollectionColors: jest.fn((collections) => collections.map((collection) => ({
        ...collection,
        color: 'blue',
    }))),
    migrateColor: jest.fn((color) => (
        typeof color === 'string' && color.startsWith('#') ? 'blue' : color
    )),
}));

describe('migrationCoordinator', () => {
    let storageUtils;
    let dataValidation;
    let migrationSupport40;
    let backupUtils;
    let colorMigration;
    let migrationCoordinator;
    let MIGRATION_CONFIG;

    const loadModule = () => {
        ({ migrationCoordinator, MIGRATION_CONFIG } = require('../app/utils/migrationCoordinator.js'));
    };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        storageUtils = require('../app/utils/storageUtils.js');
        dataValidation = require('../app/utils/dataValidation.js');
        migrationSupport40 = require('../app/utils/migrationSupport40.js');
        backupUtils = require('../app/utils/backupUtils.js');
        colorMigration = require('../app/utils/colorMigration.js');

        storageUtils.getAllStorageData.mockResolvedValue({});
        storageUtils.safeStorageSet.mockResolvedValue(true);
        storageUtils.safeStorageGet.mockResolvedValue({});
        storageUtils.safeStorageRemove.mockResolvedValue(true);
        storageUtils.atomicStorageTransaction.mockImplementation(async (fn) => {
            await fn();
            return true;
        });
        storageUtils.getStorageStats.mockResolvedValue({ totalSizeMB: '1.00' });

        dataValidation.detectAndValidateFormat.mockReturnValue({
            format: 'array',
            isValid: true,
            errors: [],
            info: { collectionCount: 1 },
        });
        dataValidation.isDataSafe.mockReturnValue(true);

        migrationSupport40.assessMigrationSupport40.mockReturnValue({
            currentVersion: '4.0',
            supported: true,
            migrationNeeded: false,
            migrationPath: [],
        });

        backupUtils.createMigrationBackup.mockResolvedValue({
            key: 'backup-1',
        });
        backupUtils.createRollbackChain.mockResolvedValue('chain-1');
        backupUtils.addToRollbackChain.mockResolvedValue(true);
        backupUtils.executeRollback.mockResolvedValue(true);
        backupUtils.cleanupOldBackups.mockResolvedValue(1);

        global.chrome = {
            runtime: {
                getManifest: () => ({ version: '4.0.1' }),
            },
        };

        loadModule();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.chrome;
    });

    test('reports unsupported legacy runtime data without attempting migration history checks', async () => {
        storageUtils.getAllStorageData.mockResolvedValue({ legacy: true });
        migrationSupport40.assessMigrationSupport40.mockReturnValue({
            currentVersion: '3.5',
            supported: false,
            unsupportedReason: 'Unsupported pre-4.0 runtime data detected',
        });

        const result = await migrationCoordinator.assessMigrationNeeds();

        expect(result).toEqual(expect.objectContaining({
            currentVersion: '3.5',
            unsupported: true,
            unsupportedReason: 'Unsupported pre-4.0 runtime data detected',
            migrationNeeded: false,
        }));
    });

    test('treats current app major.minor versions as already migrated when history matches', async () => {
        storageUtils.getAllStorageData.mockResolvedValue({
            tabsArray: [{ color: 'blue' }],
        });
        storageUtils.safeStorageGet.mockResolvedValue({
            migration_history: {
                completedVersions: ['4.0'],
                lastMigrationTimestamp: 1,
                migrationAttempts: 1,
            },
        });

        const result = await migrationCoordinator.assessMigrationNeeds();

        expect(result).toEqual(expect.objectContaining({
            alreadyCompleted: true,
            migrationNeeded: false,
        }));
    });

    test('requests a color-only migration when the version is complete but old colors remain', async () => {
        storageUtils.getAllStorageData.mockResolvedValue({
            tabsArray: [{ color: '#123456' }],
        });
        storageUtils.safeStorageGet.mockResolvedValue({
            migration_history: {
                completedVersions: ['4.0'],
                lastMigrationTimestamp: 1,
                migrationAttempts: 1,
            },
        });

        const result = await migrationCoordinator.assessMigrationNeeds();

        expect(result).toEqual(expect.objectContaining({
            migrationNeeded: true,
            migrationPath: ['color_migration'],
        }));
    });

    test('requests a deferred-url repair when the version is complete but wrapper URLs remain', async () => {
        storageUtils.getAllStorageData.mockResolvedValue({
            collections_index: { c1: { name: 'C1' } },
            collection_c1: {
                uid: 'c1',
                name: 'C1',
                tabs: [{ url: 'chrome-extension://x/deferedLoading.html?url=https%3A%2F%2Freal.example' }],
            },
        });
        storageUtils.safeStorageGet.mockResolvedValue({
            migration_history: {
                completedVersions: ['4.0'],
                lastMigrationTimestamp: 1,
                migrationAttempts: 1,
            },
        });
        migrationSupport40.assessMigrationSupport40.mockReturnValue({
            currentVersion: '4.0',
            supported: true,
            migrationNeeded: true,
            migrationPath: ['repair_deferred_urls'],
        });

        const result = await migrationCoordinator.assessMigrationNeeds();

        expect(result).toEqual(expect.objectContaining({
            migrationNeeded: true,
            migrationPath: ['repair_deferred_urls'],
        }));
    });

    test('repairDeferredUrls unwraps wrapper URLs in indexed records and the tabsArray mirror', async () => {
        const real = 'https://example.com/page';
        const wrapper = `chrome-extension://x/deferedLoading.html?url=${encodeURIComponent(real)}`;
        const data = {
            collections_index: { c1: {} },
            collection_c1: { uid: 'c1', tabs: [{ url: wrapper }, { url: 'https://clean.example' }] },
            tabsArray: [{ uid: 'c1', tabs: [{ url: wrapper }] }],
            other_key: { keep: true },
        };

        const result = await migrationCoordinator.repairDeferredUrls(data);

        expect(result.collection_c1.tabs[0].url).toBe(real);
        expect(result.collection_c1.tabs[1].url).toBe('https://clean.example');
        expect(result.tabsArray[0].tabs[0].url).toBe(real);
        // Unrelated keys are preserved untouched.
        expect(result.other_key).toEqual({ keep: true });
    });

    test('skips executeMigration when a migration lock already exists', async () => {
        jest.spyOn(migrationCoordinator, 'checkMigrationLock').mockResolvedValue(true);

        const result = await migrationCoordinator.executeMigration();

        expect(result).toEqual(expect.objectContaining({
            success: true,
            skipped: true,
        }));
    });

    test('returns no-op success when no migration is required', async () => {
        jest.spyOn(migrationCoordinator, 'checkMigrationLock').mockResolvedValue(false);
        jest.spyOn(migrationCoordinator, 'setMigrationLock').mockResolvedValue();
        jest.spyOn(migrationCoordinator, 'clearMigrationLock').mockResolvedValue();
        jest.spyOn(migrationCoordinator, 'assessMigrationNeeds').mockResolvedValue({
            migrationNeeded: false,
            currentVersion: '4.0',
            migrationPath: [],
        });

        const result = await migrationCoordinator.executeMigration();

        expect(result).toEqual(expect.objectContaining({
            success: true,
            message: 'No migration required',
        }));
    });

    test('completes executeMigration when steps succeed', async () => {
        jest.spyOn(migrationCoordinator, 'checkMigrationLock').mockResolvedValue(false);
        jest.spyOn(migrationCoordinator, 'setMigrationLock').mockResolvedValue();
        jest.spyOn(migrationCoordinator, 'clearMigrationLock').mockResolvedValue();
        jest.spyOn(migrationCoordinator, 'cleanupOldBackupsSafely').mockResolvedValue();
        jest.spyOn(migrationCoordinator, 'markMigrationCompleted').mockResolvedValue();
        jest.spyOn(migrationCoordinator, 'updateSchemaVersion').mockResolvedValue(true);
        jest.spyOn(migrationCoordinator, 'assessMigrationNeeds').mockResolvedValue({
            migrationNeeded: true,
            currentVersion: '4.0',
            migrationPath: ['timestamp_migration'],
        });
        jest.spyOn(migrationCoordinator, 'executeMigrationSteps').mockResolvedValue({
            success: true,
        });

        const result = await migrationCoordinator.executeMigration();

        expect(result).toEqual(expect.objectContaining({
            success: true,
            fromVersion: '4.0',
            toVersion: MIGRATION_CONFIG.CURRENT_VERSION,
            rollbackChainId: 'chain-1',
        }));
    });

    test('rolls back executeMigration when a step fails', async () => {
        jest.spyOn(migrationCoordinator, 'checkMigrationLock').mockResolvedValue(false);
        jest.spyOn(migrationCoordinator, 'setMigrationLock').mockResolvedValue();
        jest.spyOn(migrationCoordinator, 'clearMigrationLock').mockResolvedValue();
        jest.spyOn(migrationCoordinator, 'assessMigrationNeeds').mockResolvedValue({
            migrationNeeded: true,
            currentVersion: '4.0',
            migrationPath: ['timestamp_migration'],
        });
        jest.spyOn(migrationCoordinator, 'executeMigrationSteps').mockResolvedValue({
            success: false,
            error: 'boom',
        });

        const result = await migrationCoordinator.executeMigration();

        expect(result).toEqual(expect.objectContaining({
            success: false,
            rollbackSuccess: true,
        }));
        expect(backupUtils.executeRollback).toHaveBeenCalledWith('chain-1');
    });

    test('clears stale migration locks older than 30 minutes', async () => {
        const clearLockSpy = jest.spyOn(migrationCoordinator, 'clearMigrationLock').mockResolvedValue();
        storageUtils.safeStorageGet.mockResolvedValue({
            migration_lock: {
                timestamp: Date.now() - (31 * 60 * 1000),
            },
        });

        const result = await migrationCoordinator.checkMigrationLock();

        expect(result).toBe(false);
        expect(clearLockSpy).toHaveBeenCalled();
    });

    test('executes safe migration steps without creating backups and writes transformed data', async () => {
        storageUtils.getAllStorageData.mockResolvedValue({
            tabsArray: [{ uid: 'collection-1', createdOn: 123 }],
        });
        migrationCoordinator.rollbackChainId = 'chain-1';

        const result = await migrationCoordinator.executeMigrationSteps('4.0', ['timestamp_migration']);

        expect(result).toEqual({ success: true });
        expect(backupUtils.addToRollbackChain).toHaveBeenCalledWith('chain-1', 0, expect.objectContaining({
            skipped: true,
        }));
        expect(storageUtils.safeStorageSet).toHaveBeenCalledWith(expect.objectContaining({
            tabsArray: [expect.objectContaining({
                lastUpdated: 123,
                lastOpened: null,
            })],
        }));
    });

    test('returns a failed execution result when atomicStorageTransaction returns false', async () => {
        storageUtils.atomicStorageTransaction.mockResolvedValue(false);
        storageUtils.getAllStorageData.mockResolvedValue({
            tabsArray: [{ uid: 'collection-1', createdOn: 123 }],
        });

        const result = await migrationCoordinator.executeMigrationSteps('4.0', ['timestamp_migration']);

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Migration step timestamp_migration failed',
        }));
    });

    test('migrates colors using the shared color migration helper', async () => {
        const result = await migrationCoordinator.migrateColorsOnly({
            tabsArray: [{ uid: 'collection-1', color: '#123456' }],
        });

        expect(colorMigration.migrateAllCollectionColors).toHaveBeenCalledWith([
            { uid: 'collection-1', color: '#123456' },
        ]);
        expect(result).toEqual(expect.objectContaining({
            colorSystemVersion: '2.0',
            tabsArray: [{ uid: 'collection-1', color: 'blue' }],
        }));
    });

    test('migrates colors in indexed collection/folder records and syncs the index', async () => {
        const result = await migrationCoordinator.migrateColorsOnly({
            collections_index: { c1: { color: '#123456' } },
            collection_c1: { uid: 'c1', color: '#123456', tabs: [] },
            folder_f1: { uid: 'f1', color: '#abcdef' },
        });

        // Indexed records are the source of truth for display and must be migrated,
        // not just the legacy tabsArray mirror.
        expect(result.collection_c1.color).toBe('blue');
        expect(result.folder_f1.color).toBe('blue');
        // Index color metadata is kept in sync with the record.
        expect(result.collections_index.c1.color).toBe('blue');
        expect(result.colorSystemVersion).toBe('2.0');
    });

    test('adds timestamps and lastOpened fallbacks during timestamp migration', async () => {
        const result = await migrationCoordinator.migrateTimestamps({
            tabsArray: [
                {
                    uid: 'collection-1',
                    createdOn: 100,
                },
                {
                    uid: 'collection-2',
                    createdOn: 200,
                    lastUpdated: 500,
                },
            ],
            folders_index: {
                folder_1: {
                    createdOn: 300,
                },
            },
        });

        expect(result.tabsArray).toEqual([
            expect.objectContaining({
                uid: 'collection-1',
                lastUpdated: 100,
                lastOpened: null,
            }),
            expect.objectContaining({
                uid: 'collection-2',
                lastUpdated: 500,
                lastOpened: null,
            }),
        ]);
        expect(result.folders_index.folder_1).toEqual(expect.objectContaining({
            lastUpdated: 300,
        }));
        expect(result.timestampMigrationCompleted).toBe(true);
    });

    test('detects old collection or chrome group colors that still need migration', () => {
        expect(migrationCoordinator.needsColorMigration({
            tabsArray: [{ color: '#123456' }],
        })).toBe(true);
        expect(migrationCoordinator.needsColorMigration({
            tabsArray: [{ color: 'blue' }],
        })).toBe(false);
        expect(migrationCoordinator.needsColorMigration({
            tabsArray: [{ chromeGroups: [{ color: '#654321' }] }],
        })).toBe(true);
    });

    test('tracks migration history using major.minor versions only', async () => {
        storageUtils.safeStorageGet.mockResolvedValue({
            migration_history: {
                completedVersions: ['3.9'],
                lastMigrationTimestamp: 0,
                migrationAttempts: 0,
            },
        });

        await migrationCoordinator.markMigrationCompleted();

        expect(storageUtils.safeStorageSet).toHaveBeenCalledWith({
            migration_history: expect.objectContaining({
                completedVersions: ['3.9', '4.0'],
                migrationAttempts: 1,
            }),
        });
        expect(migrationCoordinator.getMajorMinorVersion('4.0.7')).toBe('4.0');
    });
});
