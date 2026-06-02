jest.mock('../app/utils/storageUtils.js', () => ({
    safeStorageGet: jest.fn(),
    safeStorageSet: jest.fn(),
    getAllStorageData: jest.fn(),
    safeStorageRemove: jest.fn(),
    getStorageStats: jest.fn(),
}));

jest.mock('../app/utils/dataValidation.js', () => ({
    generateDataReport: jest.fn(),
    isDataSafe: jest.fn(),
}));

const storageUtils = require('../app/utils/storageUtils.js');
const dataValidation = require('../app/utils/dataValidation.js');
const backupUtils = require('../app/utils/backupUtils.js');

describe('backupUtils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-03-31T12:00:00Z'));

        storageUtils.getAllStorageData.mockResolvedValue({
            tabsArray: [{ uid: 'collection-1', name: 'Collection One', tabs: [] }],
        });
        storageUtils.getStorageStats.mockResolvedValue({
            totalSizeMB: '1.25',
        });
        storageUtils.safeStorageSet.mockResolvedValue(true);
        storageUtils.safeStorageGet.mockResolvedValue({});
        storageUtils.safeStorageRemove.mockResolvedValue(true);

        dataValidation.isDataSafe.mockReturnValue(true);
        dataValidation.generateDataReport.mockReturnValue({
            collections: 1,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('creates a full backup and updates the backup index', async () => {
        const result = await backupUtils.createBackup('MIGRATION', 'Before migration');

        expect(result).toEqual(expect.objectContaining({
            key: expect.stringMatching(/^migration_backup_/),
            collections: 1,
        }));
        expect(storageUtils.safeStorageSet).toHaveBeenNthCalledWith(1, {
            [result.key]: expect.objectContaining({
                type: 'MIGRATION',
                reason: 'Before migration',
                data: {
                    tabsArray: [{ uid: 'collection-1', name: 'Collection One', tabs: [] }],
                },
            }),
        });
        expect(storageUtils.safeStorageSet).toHaveBeenNthCalledWith(2, {
            backup_index: expect.objectContaining({
                backups: expect.objectContaining({
                    [result.key]: expect.objectContaining({
                        type: 'MIGRATION',
                        collections: 1,
                    }),
                }),
            }),
        });
    });

    test('falls back to a minimal backup when custom data is larger than 5MB', async () => {
        const result = await backupUtils.createBackup('EMERGENCY', 'Large backup', {
            tabsArray: [],
            hugePayload: 'x'.repeat(6 * 1024 * 1024),
            folder_folder_1: { uid: 'folder-1', name: 'Folder One' },
        });

        expect(result).toEqual(expect.objectContaining({
            key: expect.stringMatching(/^emergency_backup_minimal_/),
            minimal: true,
        }));
        expect(storageUtils.safeStorageSet).toHaveBeenCalledWith({
            [result.key]: expect.objectContaining({
                minimal: true,
                data: expect.objectContaining({
                    tabsArray: [],
                    folder_folder_1: { uid: 'folder-1', name: 'Folder One' },
                }),
            }),
        });
    });

    test('skips backup creation when storage is already too large', async () => {
        storageUtils.getStorageStats.mockResolvedValue({
            totalSizeMB: '8.75',
        });

        const result = await backupUtils.createBackup('EMERGENCY', 'Quota protection');

        expect(result).toEqual(expect.objectContaining({
            skipped: true,
            reason: 'Storage too large',
        }));
        expect(storageUtils.safeStorageSet).not.toHaveBeenCalled();
    });

    test('retries with a minimal backup when the full backup hits quota limits', async () => {
        storageUtils.safeStorageSet
            .mockRejectedValueOnce(new Error('QUOTA_BYTES_PER_ITEM exceeded'))
            .mockResolvedValueOnce(true);

        const result = await backupUtils.createBackup('EMERGENCY', 'Quota retry');

        expect(result).toEqual(expect.objectContaining({
            key: expect.stringMatching(/^emergency_backup_minimal_/),
            minimal: true,
        }));
        expect(storageUtils.safeStorageSet).toHaveBeenCalledTimes(2);
    });

    test('restores a backup after creating an emergency backup of the current state', async () => {
        storageUtils.safeStorageGet.mockImplementation(async (key) => {
            if (key === 'restore_key') {
                return {
                    restore_key: {
                        id: 'backup-restore',
                        timestamp: Date.now(),
                        data: { tabsArray: [], localTimestamp: 123 },
                    },
                };
            }

            if (key === 'backup_index') {
                return {};
            }

            return {};
        });

        const result = await backupUtils.restoreFromBackup('restore_key', true);

        expect(result).toBe(true);
        expect(storageUtils.safeStorageSet).toHaveBeenLastCalledWith({
            tabsArray: [],
            localTimestamp: 123,
        });
    });

    test('refuses to restore an unsafe backup payload', async () => {
        storageUtils.safeStorageGet.mockResolvedValue({
            restore_key: {
                data: { tabsArray: [] },
            },
        });
        dataValidation.isDataSafe.mockReturnValue(false);

        const result = await backupUtils.restoreFromBackup('restore_key', true);

        expect(result).toBe(false);
        expect(storageUtils.safeStorageSet).not.toHaveBeenCalledWith({
            tabsArray: [],
        });
    });

    test('lists backups by type and sorts them newest first', async () => {
        storageUtils.getAllStorageData.mockResolvedValue({
            migration_backup_100: {
                id: 'backup-1',
                timestamp: 100,
                type: 'MIGRATION',
                reason: 'Older',
                dataReport: { collections: 1 },
                dataSize: 20,
            },
            migration_backup_300: {
                id: 'backup-3',
                timestamp: 300,
                type: 'MIGRATION',
                reason: 'Newest',
                dataReport: { collections: 2 },
                dataSize: 30,
            },
            emergency_backup_200: {
                id: 'backup-2',
                timestamp: 200,
                type: 'EMERGENCY',
                reason: 'Middle',
                dataReport: { collections: 1 },
                dataSize: 10,
            },
        });

        const backups = await backupUtils.getAvailableBackups('MIGRATION');

        expect(backups.map((backup) => backup.key)).toEqual([
            'migration_backup_300',
            'migration_backup_100',
        ]);
    });

    test('cleans up excess and stale backups', async () => {
        storageUtils.getAllStorageData.mockResolvedValue({
            migration_backup_1: {
                id: 'backup-1',
                timestamp: Date.now() - 1000,
                type: 'MIGRATION',
                reason: 'Newest',
                dataReport: { collections: 1 },
                dataSize: 10,
            },
            migration_backup_2: {
                id: 'backup-2',
                timestamp: Date.now() - 2000,
                type: 'MIGRATION',
                reason: 'Middle',
                dataReport: { collections: 1 },
                dataSize: 10,
            },
            migration_backup_3: {
                id: 'backup-3',
                timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000),
                type: 'MIGRATION',
                reason: 'Oldest',
                dataReport: { collections: 1 },
                dataSize: 10,
            },
        });

        const cleaned = await backupUtils.cleanupOldBackups(1, 30 * 24 * 60 * 60 * 1000);

        expect(cleaned).toBe(2);
        expect(storageUtils.safeStorageRemove).toHaveBeenCalledWith('migration_backup_2');
        expect(storageUtils.safeStorageRemove).toHaveBeenCalledWith('migration_backup_3');
    });

    test('creates and updates rollback chains', async () => {
        storageUtils.safeStorageGet.mockResolvedValue({
            rollback_chain_operation_123: {
                id: 'operation_123',
                operationId: 'operation',
                steps: ['one'],
                backups: {},
                currentStep: -1,
            },
        });

        const chainId = await backupUtils.createRollbackChain('operation', ['one']);
        const added = await backupUtils.addToRollbackChain('operation_123', 0, { key: 'backup-1' });

        expect(chainId).toMatch(/^operation_/);
        expect(added).toBe(true);
        expect(storageUtils.safeStorageSet).toHaveBeenCalledWith({
            rollback_chain_operation_123: expect.objectContaining({
                backups: {
                    0: { key: 'backup-1' },
                },
                currentStep: 0,
            }),
        });
    });

    test('marks skipped rollback chains as restored without loading a backup', async () => {
        storageUtils.safeStorageGet.mockResolvedValue({
            rollback_chain_chain_1: {
                id: 'chain_1',
                backups: {
                    0: {
                        skipped: true,
                    },
                },
            },
        });

        const result = await backupUtils.executeRollback('chain_1', 0);

        expect(result).toBe(true);
        expect(storageUtils.safeStorageSet).toHaveBeenCalledWith({
            rollback_chain_chain_1: expect.objectContaining({
                rolledBack: true,
                rollbackNote: 'Skipped restore — atomic transaction rollback handled recovery',
            }),
        });
    });

    test('summarizes backup statistics by type', async () => {
        storageUtils.getAllStorageData.mockResolvedValue({
            migration_backup_1: {
                id: 'backup-1',
                timestamp: 100,
                type: 'MIGRATION',
                reason: 'One',
                dataReport: { collections: 1 },
                dataSize: 12,
            },
            emergency_backup_2: {
                id: 'backup-2',
                timestamp: 200,
                type: 'EMERGENCY',
                reason: 'Two',
                dataReport: { collections: 3 },
                dataSize: 18,
            },
        });

        const stats = await backupUtils.getBackupStats();

        expect(stats.totalBackups).toBe(2);
        expect(stats.byType).toEqual({
            MIGRATION: { count: 1, size: 12 },
            EMERGENCY: { count: 1, size: 18 },
        });
        expect(stats.oldest).toEqual(expect.objectContaining({ key: 'migration_backup_1' }));
        expect(stats.newest).toEqual(expect.objectContaining({ key: 'emergency_backup_2' }));
    });
});
