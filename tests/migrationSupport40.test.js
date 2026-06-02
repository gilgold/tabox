const { createVersion40LocalSnapshot } = require('./helpers/upgradeFixtures');

describe('migration support 4.0 module', () => {
    let migrationSupport40;

    beforeEach(() => {
        jest.resetModules();
        migrationSupport40 = require('../app/utils/migrationSupport40.js');
    });

    test('treats clean 4.0 indexed data as supported with no migration needed', () => {
        const assessment = migrationSupport40.assessMigrationSupport40(createVersion40LocalSnapshot());

        expect(assessment).toEqual({
            currentVersion: '4.0',
            supported: true,
            migrationNeeded: false,
            migrationPath: [],
            unsupportedReason: null
        });
    });

    test('treats empty storage as a supported no-op', () => {
        expect(migrationSupport40.assessMigrationSupport40({})).toEqual({
            currentVersion: '4.0',
            supported: true,
            migrationNeeded: false,
            migrationPath: [],
            unsupportedReason: null
        });
    });

    test('treats omitted storage input as a supported no-op', () => {
        expect(migrationSupport40.assessMigrationSupport40()).toEqual({
            currentVersion: '4.0',
            supported: true,
            migrationNeeded: false,
            migrationPath: [],
            unsupportedReason: null
        });
    });

    test('flags missing timestamps in 4.0 indexed data for repair', () => {
        const snapshot = createVersion40LocalSnapshot();
        delete snapshot['collection_collection-root-a'].lastUpdated;

        const assessment = migrationSupport40.assessMigrationSupport40(snapshot);

        expect(assessment.migrationNeeded).toBe(true);
        expect(assessment.migrationPath).toEqual(['timestamp_migration']);
    });

    test('flags old collection colors in 4.0 indexed data for repair', () => {
        const snapshot = createVersion40LocalSnapshot();
        snapshot['collection_collection-root-a'].color = '#123456';

        const assessment = migrationSupport40.assessMigrationSupport40(snapshot);

        expect(assessment.migrationNeeded).toBe(true);
        expect(assessment.migrationPath).toEqual(['color_migration']);
    });

    test('refuses automatic migration for pre-4.0 array-only runtime data', () => {
        const assessment = migrationSupport40.assessMigrationSupport40({
            tabsArray: [
                {
                    uid: 'legacy-collection',
                    name: 'Legacy Collection',
                    tabs: []
                }
            ]
        });

        expect(assessment).toEqual({
            currentVersion: 'pre-4.0',
            supported: false,
            migrationNeeded: false,
            migrationPath: [],
            unsupportedReason: 'pre_4_runtime_data'
        });
    });
});
