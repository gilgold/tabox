jest.mock('../app/utils/storageUtils.js', () => ({
    safeStorageGet: jest.fn(),
    safeStorageSet: jest.fn(),
    safeStorageRemove: jest.fn(),
}));

jest.mock('../app/utils/dataValidation.js', () => ({
    validateCollection: jest.fn(),
    isDataSafe: jest.fn(),
}));

jest.mock('../app/utils/backupUtils.js', () => ({
    createBackup: jest.fn(),
    getAvailableBackups: jest.fn(),
}));

jest.mock('../app/utils/migrationCoordinator.js', () => ({
    assessMigrationNeeds: jest.fn(),
    MIGRATION_CONFIG: {
        CURRENT_VERSION: '4.0',
    },
}));

describe('migrationHealthCheck', () => {
    let storageUtils;
    let dataValidation;
    let backupUtils;
    let migrationCoordinatorApi;
    let errorSpy;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        // The health check intentionally logs console.error when a component
        // fails — several tests below exercise those failure paths.
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        storageUtils = require('../app/utils/storageUtils.js');
        dataValidation = require('../app/utils/dataValidation.js');
        backupUtils = require('../app/utils/backupUtils.js');
        migrationCoordinatorApi = require('../app/utils/migrationCoordinator.js');

        storageUtils.safeStorageGet.mockImplementation(async (key) => ({
            [key]: { test: true, timestamp: Date.now() },
        }));
        storageUtils.safeStorageSet.mockResolvedValue(true);
        storageUtils.safeStorageRemove.mockResolvedValue(true);

        dataValidation.validateCollection.mockReturnValue({
            isValid: true,
            errors: [],
        });
        dataValidation.isDataSafe.mockReturnValue(true);

        backupUtils.createBackup.mockResolvedValue({ key: 'backup-1' });
        backupUtils.getAvailableBackups.mockResolvedValue([]);
        migrationCoordinatorApi.assessMigrationNeeds.mockResolvedValue({
            migrationNeeded: false,
        });

        delete global.browser;
        delete global.chrome;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('reports warning when browser APIs are unavailable but validation still works', async () => {
        const { performMigrationHealthCheck } = require('../app/utils/migrationHealthCheck.js');

        const result = await performMigrationHealthCheck();

        expect(result.overall).toBe('warning');
        expect(result.components).toEqual({
            storage: 'warning',
            validation: 'healthy',
            backup: 'warning',
            coordinator: 'warning',
        });
    });

    test('reports healthy when every component succeeds in a browser context', async () => {
        global.browser = {
            runtime: {
                getManifest: () => ({ version: '4.0.1' }),
            },
        };

        const { performMigrationHealthCheck } = require('../app/utils/migrationHealthCheck.js');
        const result = await performMigrationHealthCheck();

        expect(result.overall).toBe('healthy');
        expect(result.components).toEqual({
            storage: 'healthy',
            validation: 'healthy',
            backup: 'healthy',
            coordinator: 'healthy',
        });
    });

    test('reports degraded when a storage dependency fails', async () => {
        global.browser = {
            runtime: {
                getManifest: () => ({ version: '4.0.1' }),
            },
        };
        storageUtils.safeStorageSet.mockResolvedValueOnce(false);

        const { performMigrationHealthCheck } = require('../app/utils/migrationHealthCheck.js');
        const result = await performMigrationHealthCheck();

        expect(result.overall).toBe('degraded');
        expect(result.components.storage).toBe('failed');
        expect(result.recommendations).toEqual(expect.arrayContaining([
            'Some migration components have issues - check console for details',
        ]));
        expect(errorSpy).toHaveBeenCalledWith('Storage utils test failed:', expect.any(Error));
    });

    test('returns false from isMigrationSystemHealthy when the health check fails', async () => {
        global.browser = {
            runtime: {
                getManifest: () => ({ version: '4.0.1' }),
            },
        };
        dataValidation.validateCollection.mockImplementation(() => {
            throw new Error('validation exploded');
        });

        const { isMigrationSystemHealthy } = require('../app/utils/migrationHealthCheck.js');
        const result = await isMigrationSystemHealthy();

        expect(result).toBe(false);
        expect(errorSpy).toHaveBeenCalledWith('Data validation test failed:', expect.any(Error));
    });
});
